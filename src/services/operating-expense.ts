import { and, eq, isNull, like, sql } from "drizzle-orm";
import { openDb, type Db } from "@/db";
import {
  costLines,
  dailySheets,
  operatingExpenses,
  type OperatingExpense,
} from "@/db/schema";
import { isValidMonthStr, subSen, sumSen } from "@/lib/money";
import {
  assertMonthNotClosed,
  assertValidSen,
  ClosedMonthError,
  NotFoundError,
  ValidationError,
} from "./daily-sheet";

export {
  ClosedMonthError,
  NotFoundError,
  ValidationError,
  assertMonthNotClosed,
  assertValidSen,
  isMonthClosed,
} from "./daily-sheet";

export const OPERATING_EXPENSE_TYPES = [
  "rental",
  "utilities",
  "wages",
  "other",
] as const;

export type OperatingExpenseType = (typeof OPERATING_EXPENSE_TYPES)[number];

/**
 * Checks whether a type is a valid Operating Expense type per CONTEXT.md and schema.
 */
export function isValidOperatingExpenseType(
  type: unknown,
): type is OperatingExpenseType {
  return (
    typeof type === "string" &&
    OPERATING_EXPENSE_TYPES.includes(type as OperatingExpenseType)
  );
}

export interface UpdateOperatingExpenseInput {
  month?: string;
  type?: OperatingExpenseType;
  amountSen?: number | bigint;
  note?: string | null;
}

export interface MonthPreview {
  month: string;
  revenueSen: bigint;
  dailyCostSen: bigint;
  grossSen: bigint;
  operatingSen: bigint;
  netSen: bigint;
}

/**
 * Add an Operating Expense for a month.
 * - Month must be valid YYYY-MM
 * - Type enum: rental | utilities | wages | other
 * - Note required when type is 'other'
 * - Amount must be a non-negative sen integer
 * - Rejects writes to CLOSED months (ClosedMonthError)
 * - If expense with same month, type, and note exists, merges amount into existing row
 */
export async function addOperatingExpense(
  month: string,
  type: OperatingExpenseType,
  amountSen: number | bigint,
  note?: string | null,
  options?: { db?: Db },
): Promise<OperatingExpense> {
  const db = options?.db ?? openDb().db;

  if (!isValidMonthStr(month)) {
    throw new ValidationError(
      `Invalid month format: "${month}", expected YYYY-MM`,
    );
  }

  assertMonthNotClosed(month, db);

  if (!isValidOperatingExpenseType(type)) {
    throw new ValidationError(
      `Invalid Operating Expense type: "${String(type)}". Must be one of: ${OPERATING_EXPENSE_TYPES.join(", ")}`,
    );
  }

  const trimmedNote = note?.trim() || null;
  if (type === "other" && !trimmedNote) {
    throw new ValidationError(
      "Note is required when Operating Expense type is 'other'",
    );
  }

  const validAmount = assertValidSen(
    amountSen,
    "Operating Expense amount (amountSen)",
  );

  const noteCondition =
    trimmedNote !== null
      ? eq(operatingExpenses.note, trimmedNote)
      : isNull(operatingExpenses.note);

  const existing = db
    .select()
    .from(operatingExpenses)
    .where(
      and(
        eq(operatingExpenses.month, month),
        eq(operatingExpenses.type, type),
        noteCondition,
      ),
    )
    .get();

  if (existing) {
    const updated = db
      .update(operatingExpenses)
      .set({
        amountSen: sql`${operatingExpenses.amountSen} + ${Number(validAmount)}`,
      })
      .where(eq(operatingExpenses.id, existing.id))
      .returning()
      .get();

    return updated;
  }

  const inserted = db
    .insert(operatingExpenses)
    .values({
      month,
      type,
      amountSen: Number(validAmount),
      note: trimmedNote,
    })
    .returning()
    .get();

  return inserted;
}

/**
 * List all Operating Expenses for a given month ("YYYY-MM").
 */
export async function listOperatingExpenses(
  month: string,
  options?: { db?: Db },
): Promise<OperatingExpense[]> {
  const db = options?.db ?? openDb().db;

  if (!isValidMonthStr(month)) {
    throw new ValidationError(
      `Invalid month format: "${month}", expected YYYY-MM`,
    );
  }

  return db
    .select()
    .from(operatingExpenses)
    .where(eq(operatingExpenses.month, month))
    .orderBy(operatingExpenses.id)
    .all();
}

/**
 * Update an existing Operating Expense.
 * - Checks that existing month is open (and target month if changed)
 * - Validates type, note (required if other), and amountSen
 * - Rejects writes to CLOSED months (ClosedMonthError)
 */
export async function updateOperatingExpense(
  id: number,
  updates: UpdateOperatingExpenseInput,
  options?: { db?: Db },
): Promise<OperatingExpense> {
  const db = options?.db ?? openDb().db;

  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`Invalid Operating Expense id: ${id}`);
  }

  const existing = db
    .select()
    .from(operatingExpenses)
    .where(eq(operatingExpenses.id, id))
    .get();

  if (!existing) {
    throw new NotFoundError(`Operating Expense with id ${id} not found`);
  }

  assertMonthNotClosed(existing.month, db);

  if (updates.month !== undefined) {
    if (!isValidMonthStr(updates.month)) {
      throw new ValidationError(
        `Invalid month format: "${updates.month}", expected YYYY-MM`,
      );
    }
    assertMonthNotClosed(updates.month, db);
  }

  const finalType = updates.type ?? (existing.type as OperatingExpenseType);
  if (!isValidOperatingExpenseType(finalType)) {
    throw new ValidationError(
      `Invalid Operating Expense type: "${String(finalType)}". Must be one of: ${OPERATING_EXPENSE_TYPES.join(", ")}`,
    );
  }

  const finalNote =
    updates.note !== undefined
      ? updates.note?.trim() || null
      : existing.note;

  let finalAmountSen = existing.amountSen;
  if (updates.amountSen !== undefined) {
    const valid = assertValidSen(
      updates.amountSen,
      "Operating Expense amount (amountSen)",
    );
    finalAmountSen = Number(valid);
  }

  if (finalType === "other" && !finalNote) {
    throw new ValidationError(
      "Note is required when Operating Expense type is 'other'",
    );
  }

  const updated = db
    .update(operatingExpenses)
    .set({
      month: updates.month !== undefined ? updates.month : existing.month,
      type: finalType,
      amountSen: finalAmountSen,
      note: finalNote,
    })
    .where(eq(operatingExpenses.id, id))
    .returning()
    .get();

  return updated;
}

/**
 * Remove an Operating Expense.
 * - Month must not be closed
 * - Month close snapshot is not hard deleted
 */
export async function removeOperatingExpense(
  id: number,
  options?: { db?: Db },
): Promise<{ success: boolean; removedExpense: OperatingExpense }> {
  const db = options?.db ?? openDb().db;

  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`Invalid Operating Expense id: ${id}`);
  }

  const existing = db
    .select()
    .from(operatingExpenses)
    .where(eq(operatingExpenses.id, id))
    .get();

  if (!existing) {
    throw new NotFoundError(`Operating Expense with id ${id} not found`);
  }

  assertMonthNotClosed(existing.month, db);

  db.delete(operatingExpenses).where(eq(operatingExpenses.id, id)).run();

  return { success: true, removedExpense: existing };
}

/**
 * Live Month Preview.
 * Computes:
 * - revenueSen: sum of Cash Revenue + TnG Revenue for all Daily Sheets in month
 * - dailyCostSen: sum of all Daily Cost Lines for Daily Sheets in month
 * - grossSen: Gross Profit = revenueSen - dailyCostSen
 * - operatingSen: sum of all Operating Expenses in month
 * - netSen: Net Profit = grossSen - operatingSen
 * All calculations use integer sen via Money helpers (no floats).
 */
export async function getMonthPreview(
  month: string,
  options?: { db?: Db },
): Promise<MonthPreview> {
  const db = options?.db ?? openDb().db;

  if (!isValidMonthStr(month)) {
    throw new ValidationError(
      `Invalid month format: "${month}", expected YYYY-MM`,
    );
  }

  // 1. All Daily Sheets for this month ("YYYY-MM-DD" matching "YYYY-MM-%")
  const sheets = db
    .select({
      cashSen: dailySheets.cashSen,
      tngSen: dailySheets.tngSen,
    })
    .from(dailySheets)
    .where(like(dailySheets.date, `${month}-%`))
    .all();

  const revenueAmounts = sheets.flatMap((s) => [
    BigInt(s.cashSen),
    BigInt(s.tngSen),
  ]);
  const revenueSen = sumSen(revenueAmounts);

  // 2. All Cost Lines for Daily Sheets in this month
  const costs = db
    .select({ amountSen: costLines.amountSen })
    .from(costLines)
    .innerJoin(dailySheets, eq(costLines.dailySheetId, dailySheets.id))
    .where(like(dailySheets.date, `${month}-%`))
    .all();

  const dailyCostSen = sumSen(costs.map((c) => BigInt(c.amountSen)));

  // 3. All Operating Expenses in this month
  const expenses = db
    .select({ amountSen: operatingExpenses.amountSen })
    .from(operatingExpenses)
    .where(eq(operatingExpenses.month, month))
    .all();

  const operatingSen = sumSen(expenses.map((e) => BigInt(e.amountSen)));

  // 4. Gross Profit = revenue - dailyCosts; Net Profit = gross - operating
  const grossSen = subSen(revenueSen, dailyCostSen);
  const netSen = subSen(grossSen, operatingSen);

  return {
    month,
    revenueSen,
    dailyCostSen,
    grossSen,
    operatingSen,
    netSen,
  };
}
