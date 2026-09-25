import { and, eq, inArray, isNull, like, type SQL } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import {
  costLines,
  dailySheets,
  operatingExpenses,
  type OperatingExpense,
} from "@/db/schema";
import { isValidMonthStr, subSen, sumSen } from "@/lib/money";
import { OPERATING_EXPENSE_TYPES, type OperatingExpenseType } from "@/lib/vocab";
import {
  assertMonthNotClosed,
  assertValidNote,
  assertValidSen,
} from "./daily-sheet";
import { getTodayInKualaLumpur } from "@/lib/datetime";
import { ClosedMonthError, NotFoundError, ValidationError } from "./errors";

export {
  assertMonthNotClosed,
  assertValidNote,
  assertValidSen,
  isMonthClosed,
} from "./daily-sheet";

export type { OperatingExpense } from "@/db/schema";
export type { OperatingExpenseType };

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

/**
 * WHERE predicate matching Daily Sheets whose date ("YYYY-MM-DD") falls in month ("YYYY-MM").
 */
export function dailySheetInMonth(month: string): SQL {
  return like(dailySheets.date, `${month}-%`);
}

/**
 * Rejects Operating Expenses dated to a future month (Asia/Kuala_Lumpur wall time).
 * Mirrors the future-month rule enforced by Month Close; kept local to avoid an
 * import cycle with month-close.ts (which imports getMonthPreview from here).
 */
function assertMonthNotInFuture(month: string, now?: Date): void {
  const currentMonth = getTodayInKualaLumpur(now).slice(0, 7);
  if (month > currentMonth) {
    throw new ValidationError(
      `Month "${month}" is in the future (current month in Asia/Kuala_Lumpur is "${currentMonth}")`,
    );
  }
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
 * - Month must NOT be in the future (Asia/Kuala_Lumpur)
 * - Type enum: rental | utilities | wages | other
 * - Note required when type is 'other'
 * - Amount must be a non-negative sen integer
 * - Rejects writes to CLOSED months (ClosedMonthError)
 * - If expense with same month, type, and note exists, merges amount into existing row
 */
export type AddOperatingExpenseResult = OperatingExpense & {
  merged: boolean;
};

export async function addOperatingExpense(
  month: string,
  type: OperatingExpenseType,
  amountSen: number | bigint,
  note?: string | null,
  options?: { db?: Db; now?: Date },
): Promise<AddOperatingExpenseResult> {
  const db = options?.db ?? getDb().db;

  if (!isValidMonthStr(month)) {
    throw new ValidationError(
      `Invalid month format: "${month}", expected YYYY-MM`,
    );
  }

  assertMonthNotInFuture(month, options?.now);

  assertMonthNotClosed(month, db);

  if (!isValidOperatingExpenseType(type)) {
    throw new ValidationError(
      `Invalid Operating Expense type: "${String(type)}". Must be one of: ${OPERATING_EXPENSE_TYPES.join(", ")}`,
    );
  }

  const trimmedNote = assertValidNote(note);
  if (type === "other" && !trimmedNote) {
    throw new ValidationError(
      "Note is required when Operating Expense type is 'other'",
      "otherNoteRequired",
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

  return db.transaction((tx) => {
    assertMonthNotClosed(month, tx);

    const existing = tx
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
      const mergedTotal = BigInt(existing.amountSen) + validAmount;
      const validMergedTotal = assertValidSen(
        mergedTotal,
        "Merged Operating Expense amount (amountSen)",
      );

      const updated = tx
        .update(operatingExpenses)
        .set({
          amountSen: Number(validMergedTotal),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(operatingExpenses.id, existing.id))
        .returning()
        .get();

      return {
        ...updated,
        merged: true,
      };
    }

    const inserted = tx
      .insert(operatingExpenses)
      .values({
        month,
        type,
        amountSen: Number(validAmount),
        note: trimmedNote,
      })
      .returning()
      .get();

    return {
      ...inserted,
      merged: false,
    };
  });
}

/**
 * List all Operating Expenses for a given month ("YYYY-MM").
 */
export async function listOperatingExpenses(
  month: string,
  options?: { db?: Db },
): Promise<OperatingExpense[]> {
  const db = options?.db ?? getDb().db;

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
 * - Target month must NOT be in the future (Asia/Kuala_Lumpur)
 * - Validates type, note (required if other), and amountSen
 * - Rejects writes to CLOSED months (ClosedMonthError)
 */
export async function updateOperatingExpense(
  id: number,
  updates: UpdateOperatingExpenseInput,
  options?: { db?: Db; now?: Date },
): Promise<OperatingExpense> {
  const db = options?.db ?? getDb().db;

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
    assertMonthNotInFuture(updates.month, options?.now);
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
      ? assertValidNote(updates.note)
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
      "otherNoteRequired",
    );
  }

  const updated = db
    .update(operatingExpenses)
    .set({
      month: updates.month !== undefined ? updates.month : existing.month,
      type: finalType,
      amountSen: finalAmountSen,
      note: finalNote,
      updatedAt: new Date().toISOString(),
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
  const db = options?.db ?? getDb().db;

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
 * Remove several Operating Expenses in one transaction (a merged expense card).
 * - ids must be a non-empty array of positive integers
 * - Ids that do not exist are skipped; `deleted` counts rows actually removed
 * - If any existing row is in a closed month, nothing is deleted (ClosedMonthError)
 */
export async function deleteOperatingExpenses(
  ids: number[],
  options?: { db?: Db },
): Promise<{ deleted: number }> {
  const db = options?.db ?? getDb().db;

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError("At least one Operating Expense id is required");
  }
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError(`Invalid Operating Expense id: ${id}`);
    }
  }

  const uniqueIds = [...new Set(ids)];

  return db.transaction((tx) => {
    const existing = tx
      .select({ id: operatingExpenses.id, month: operatingExpenses.month })
      .from(operatingExpenses)
      .where(inArray(operatingExpenses.id, uniqueIds))
      .all();

    for (const month of new Set(existing.map((e) => e.month))) {
      assertMonthNotClosed(month, tx);
    }

    const result = tx
      .delete(operatingExpenses)
      .where(inArray(operatingExpenses.id, uniqueIds))
      .run();

    return { deleted: result.changes };
  });
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
 * Synchronous so it can run inside a better-sqlite3 transaction callback.
 */
export function getMonthPreviewSync(
  month: string,
  options?: { db?: Db },
): MonthPreview {
  const db = options?.db ?? getDb().db;

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
    .where(dailySheetInMonth(month))
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
    .where(dailySheetInMonth(month))
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

/**
 * Async form of {@link getMonthPreviewSync}, kept as the default entry point so
 * existing callers (and their rejects-on-invalid-month contract) are unchanged.
 * Callers running inside a better-sqlite3 transaction must use the sync form:
 * the transaction callback cannot await.
 */
export async function getMonthPreview(
  month: string,
  options?: { db?: Db },
): Promise<MonthPreview> {
  return getMonthPreviewSync(month, options);
}
