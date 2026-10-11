import { sql, type SQL } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Bokli schema. All amounts are INTEGER sen (MYR minor units) per ADR-0004.
 * Dates are TEXT "YYYY-MM-DD" in Asia/Kuala_Lumpur wall time;
 * months are TEXT "YYYY-MM".
 */

/**
 * SQL predicate: column holds a note that is not NULL, empty or whitespace-only.
 * Trims space, tab, LF, VT, FF and CR; every one of those is also stripped by the
 * services' String.prototype.trim(), so the DB never rejects a note they accept.
 */
function notBlank(column: AnySQLiteColumn): SQL {
  return sql`(${column} IS NOT NULL AND trim(${column}, char(32, 9, 10, 11, 12, 13)) <> '')`;
}

export type UserRole = "Operator" | "Admin";

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** Operator | Admin per CONTEXT.md */
    role: text("role").$type<UserRole>().notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("uq_users_username").on(t.username),
    check("chk_users_role", sql`${t.role} IN ('Operator', 'Admin')`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/** Cloud identity is additive; legacy credentials and roles stay on users. */
export const userEmails = sqliteTable("user_emails", {
  email: text("email").primaryKey().notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
}, (t) => [
  uniqueIndex("uq_user_emails_user").on(t.userId),
  check("chk_user_emails_normalized", sql`${t.email} = lower(trim(${t.email})) AND length(${t.email}) <= 254 AND ${t.email} NOT GLOB '*[^!-~]*' AND ${t.email} GLOB '?*@?*'`),
]);

export const dailySheets = sqliteTable(
  "daily_sheets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Business date, Asia/Kuala_Lumpur, "YYYY-MM-DD". One sheet per date. */
    date: text("date").notNull(),
    cashSen: integer("cash_sen").notNull().default(0),
    tngSen: integer("tng_sen").notNull().default(0),
    note: text("note"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("uq_daily_sheets_date").on(t.date),
    check("chk_daily_sheets_cash_nonneg", sql`${t.cashSen} >= 0`),
    check("chk_daily_sheets_tng_nonneg", sql`${t.tngSen} >= 0`),
  ],
);

export type DailySheet = typeof dailySheets.$inferSelect;
export type NewDailySheet = typeof dailySheets.$inferInsert;

export const costLines = sqliteTable(
  "cost_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dailySheetId: integer("daily_sheet_id")
      .notNull()
      .references(() => dailySheets.id, { onDelete: "cascade" }),
    amountSen: integer("amount_sen").notNull(),
    /** restock | gas | transport | wages-daily | maintenance | other */
    category: text("category").notNull(),
    /** Required when category = 'other'. */
    note: text("note"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("ix_cost_lines_sheet").on(t.dailySheetId),
    check(
      "chk_cost_lines_category",
      sql`${t.category} IN ('restock','gas','transport','wages-daily','maintenance','other')`,
    ),
    check(
      "chk_cost_lines_other_note",
      sql`${t.category} <> 'other' OR ${notBlank(t.note)}`,
    ),
    // Zero-amount Cost Lines are not allowed (see assertPositiveCostAmount).
    check("chk_cost_lines_amount_positive", sql`${t.amountSen} > 0`),
  ],
);

export type CostLine = typeof costLines.$inferSelect;
export type NewCostLine = typeof costLines.$inferInsert;

export const operatingExpenses = sqliteTable(
  "operating_expenses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** "YYYY-MM" */
    month: text("month").notNull(),
    /** rental | utilities | wages | other */
    type: text("type").notNull(),
    amountSen: integer("amount_sen").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("ix_operating_expenses_month").on(t.month),
    // Operating Expense identity = (month, type, note), the addOperatingExpense
    // merge key. SQLite treats NULLs as distinct in a UNIQUE index, so a NULL
    // note gets its own partial index on (month, type) to make it conflict too.
    uniqueIndex("uq_opex_month_type_note")
      .on(t.month, t.type, t.note)
      .where(sql`${t.note} IS NOT NULL`),
    uniqueIndex("uq_opex_month_type_null_note")
      .on(t.month, t.type)
      .where(sql`${t.note} IS NULL`),
    check("chk_opex_type", sql`${t.type} IN ('rental','utilities','wages','other')`),
    check("chk_opex_other_note", sql`${t.type} <> 'other' OR ${notBlank(t.note)}`),
    check("chk_opex_amount_nonneg", sql`${t.amountSen} >= 0`),
  ],
);

export type OperatingExpense = typeof operatingExpenses.$inferSelect;
export type NewOperatingExpense = typeof operatingExpenses.$inferInsert;

/**
 * Idempotency keys already handled by addOperatingExpense. A Save retried with
 * the same key (e.g. after a lost reply) replays `result` instead of adding the
 * amount again. The request columns let a key reused for a different expense be
 * rejected. No FK to operating_expenses: the key must outlive a later delete.
 */
export const operatingExpenseAddRequests = sqliteTable(
  "operating_expense_add_requests",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    month: text("month").notNull(),
    type: text("type").notNull(),
    amountSen: integer("amount_sen").notNull(),
    note: text("note"),
    /** JSON of the AddOperatingExpenseResult originally returned. */
    result: text("result").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const monthCloses = sqliteTable(
  "month_closes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    month: text("month").notNull(),
    /** Snapshot taken at close time. */
    revenueSen: integer("revenue_sen").notNull(),
    dailyCostSen: integer("daily_cost_sen").notNull(),
    grossSen: integer("gross_sen").notNull(),
    operatingSen: integer("operating_sen").notNull(),
    netSen: integer("net_sen").notNull(),
    /** Reconciliation inputs (warn-only). */
    cashOnHandSen: integer("cash_on_hand_sen"),
    tngOnHandSen: integer("tng_on_hand_sen"),
    note: text("note"),
    closedAt: text("closed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    reopenedAt: text("reopened_at"),
    reopenReason: text("reopen_reason"),
  },
  (t) => [
    uniqueIndex("uq_month_closes_month").on(t.month),
    // NULL stays legal: legacy closes may predate the Reconciliation inputs.
    check(
      "chk_month_closes_cash_on_hand_nonneg",
      sql`${t.cashOnHandSen} IS NULL OR ${t.cashOnHandSen} >= 0`,
    ),
    check(
      "chk_month_closes_tng_on_hand_nonneg",
      sql`${t.tngOnHandSen} IS NULL OR ${t.tngOnHandSen} >= 0`,
    ),
  ],
);

export type MonthClose = typeof monthCloses.$inferSelect;
export type NewMonthClose = typeof monthCloses.$inferInsert;

export type MonthCloseEventAction = "close" | "reopen";

/**
 * Append-only Month Close audit history. One row per successful close, reopen
 * and re-close, written in the same transaction as the month_closes change.
 * month_closes stays the current-state row; this table is never updated.
 */
export const monthCloseEvents = sqliteTable(
  "month_close_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** "YYYY-MM" */
    month: text("month").notNull(),
    /** close | reopen */
    action: text("action").$type<MonthCloseEventAction>().notNull(),
    /** closedAt for close events, reopenedAt for reopen events. */
    at: text("at").notNull(),
    /** Reconciliation note for close events, reopen reason for reopen events. */
    reason: text("reason"),
    /** JSON of the month_closes row as it stood right after this event. */
    snapshot: text("snapshot").notNull(),
    /** NULL on historical/laptop events; never backfilled by inference. */
    actorUserId: integer("actor_user_id").references(() => users.id),
    actorRole: text("actor_role").$type<UserRole>(),
  },
  (t) => [
    index("ix_month_close_events_month").on(t.month),
    check("chk_month_close_events_action", sql`${t.action} IN ('close', 'reopen')`),
  ],
);

export type MonthCloseEvent = typeof monthCloseEvents.$inferSelect;
export type NewMonthCloseEvent = typeof monthCloseEvents.$inferInsert;

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    usernameLower: text("username_lower").primaryKey(),
    failedCount: integer("failed_count").notNull().default(0),
    lockedUntil: text("locked_until"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_login_attempts_updated_at").on(t.updatedAt)],
);

export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type NewLoginAttempt = typeof loginAttempts.$inferInsert;

/** One commit-time gate for cloud writers. checkCode is always NULL on commit. */
export const cloudWriteGuard = sqliteTable("cloud_write_guard", {
  id: integer("id").primaryKey(),
  maintenance: integer("maintenance").notNull().default(0),
  checkCode: text("check_code"),
}, t => [check("chk_cloud_guard_singleton", sql`${t.id}=1 AND ${t.maintenance} IN (0,1) AND ${t.checkCode} IS NULL`)]);

/** The pending claim, mutation and final response are one atomic batch. No GC. */
export const cloudOperationReceipts = sqliteTable("cloud_operation_receipts", {
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  operation: text("operation").notNull(),
  operationId: text("operation_id").notNull(),
  payload: text("payload").notNull(),
  attemptToken: text("attempt_token").notNull(),
  status: integer("status"),
  result: text("result"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, t => [primaryKey({ columns: [t.actorUserId, t.operation, t.operationId] }),
  check("chk_cloud_receipt_result", sql`(${t.result} IS NULL AND ${t.status} IS NULL) OR (${t.result} IS NOT NULL AND json_valid(${t.result}) AND ${t.status} IN (200,201))`),
  check("chk_cloud_receipt_key", sql`length(${t.operationId}) BETWEEN 1 AND 200`),
  check("chk_cloud_receipt_operation", sql`${t.operation} IN ('sheet.save','sheet.delete','expense.add','expense.delete','month.close','month.reopen')`),
]);

/** Explicit imported ownership only. Original unscoped receipts remain intact. */
export const legacyExpenseReceiptOwners = sqliteTable("legacy_expense_receipt_owners", {
  idempotencyKey: text("idempotency_key").primaryKey().notNull().references(() => operatingExpenseAddRequests.idempotencyKey),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
});
