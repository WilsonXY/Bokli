import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Bokli schema. All amounts are INTEGER sen (MYR minor units) per ADR-0004.
 * Dates are TEXT "YYYY-MM-DD" in Asia/Kuala_Lumpur wall time;
 * months are TEXT "YYYY-MM".
 */

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

export const costLines = sqliteTable(
  "cost_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dailySheetId: integer("daily_sheet_id")
      .notNull()
      .references(() => dailySheets.id, { onDelete: "cascade" }),
    amountSen: integer("amount_sen").notNull(),
    /** restock | gas | transport | wages-daily | other */
    category: text("category").notNull(),
    /** Required when category = 'other'. */
    note: text("note"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("ix_cost_lines_sheet").on(t.dailySheetId),
    check(
      "chk_cost_lines_category",
      sql`${t.category} IN ('restock','gas','transport','wages-daily','other')`,
    ),
    check("chk_cost_lines_other_note", sql`${t.category} <> 'other' OR ${t.note} IS NOT NULL`),
    check("chk_cost_lines_amount_nonneg", sql`${t.amountSen} >= 0`),
  ],
);

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
  },
  (t) => [
    index("ix_operating_expenses_month").on(t.month),
    check("chk_opex_type", sql`${t.type} IN ('rental','utilities','wages','other')`),
    check("chk_opex_amount_nonneg", sql`${t.amountSen} >= 0`),
  ],
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
  (t) => [uniqueIndex("uq_month_closes_month").on(t.month)],
);
