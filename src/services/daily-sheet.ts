import { eq } from "drizzle-orm";
import { openDb, type Db } from "@/db";
import {
  costLines,
  dailySheets,
  monthCloses,
  type CostLine,
  type DailySheet,
} from "@/db/schema";
import { isValidDateStr, subSen, sumSen } from "@/lib/money";

export const COST_CATEGORIES = [
  "restock",
  "gas",
  "transport",
  "wages-daily",
  "other",
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ClosedMonthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClosedMonthError";
  }
}

export class FutureDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FutureDateError";
  }
}

/**
 * Returns today's date in Asia/Kuala_Lumpur wall time as "YYYY-MM-DD".
 */
export function getTodayInKualaLumpur(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

/**
 * Check whether a date string is in the future in Asia/Kuala_Lumpur.
 */
export function isFutureDateInKL(date: string, now: Date = new Date()): boolean {
  const today = getTodayInKualaLumpur(now);
  return date > today;
}

/**
 * Checks whether a category is a valid Cost Category per CONTEXT.md.
 */
export function isValidCostCategory(category: unknown): category is CostCategory {
  return (
    typeof category === "string" &&
    COST_CATEGORIES.includes(category as CostCategory)
  );
}

/**
 * Validates that an amount is a non-negative integer representing sen (MYR minor units).
 * Floats, negatives, strings with non-digits, and invalid values are strictly rejected.
 * Rejects values > Number.MAX_SAFE_INTEGER to prevent precision loss upon Number() conversion.
 */
export function assertValidSen(amount: unknown, fieldName: string): bigint {
  let val: bigint;
  if (typeof amount === "bigint") {
    val = amount;
  } else if (typeof amount === "number") {
    if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
      throw new ValidationError(
        `${fieldName} must be an integer (sen), received: ${amount}`,
      );
    }
    val = BigInt(amount);
  } else if (typeof amount === "string" && /^-?\d+$/.test(amount.trim())) {
    val = BigInt(amount.trim());
  } else {
    throw new ValidationError(
      `${fieldName} must be an integer (sen), received: ${String(amount)}`,
    );
  }

  if (val < 0n) {
    throw new ValidationError(
      `${fieldName} cannot be negative, received: ${val.toString()}`,
    );
  }

  if (val > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ValidationError(
      `${fieldName} exceeds maximum safe amount (${Number.MAX_SAFE_INTEGER} sen), received: ${val.toString()}`,
    );
  }

  return val;
}

/**
 * Check if a month ("YYYY-MM") is currently closed (has a month_closes record and reopenedAt IS NULL).
 */
export function isMonthClosed(month: string, db: Db): boolean {
  const close = db
    .select()
    .from(monthCloses)
    .where(eq(monthCloses.month, month))
    .get();

  return Boolean(close && !close.reopenedAt);
}

/**
 * Asserts that a month is open for edits. Throws ClosedMonthError if closed.
 */
export function assertMonthNotClosed(month: string, db: Db): void {
  if (isMonthClosed(month, db)) {
    throw new ClosedMonthError(
      `Month "${month}" is closed and cannot be edited`,
    );
  }
}

export interface DailySheetWithCosts {
  sheet: DailySheet;
  costLines: CostLine[];
  totalCostSen: bigint;
  totalRevenueSen: bigint;
  grossProfitSen: bigint;
}

/**
 * Get or create the Daily Sheet for a specific date.
 * - Enforces one Daily Sheet per date
 * - Date must be valid YYYY-MM-DD
 * - Date must not be in the future in Asia/Kuala_Lumpur
 * - Month must not be closed when creating a new sheet
 */
export function getOrCreateSheet(
  date: string,
  options?: { db?: Db; now?: Date },
): DailySheet {
  const db = options?.db ?? openDb().db;

  if (!isValidDateStr(date)) {
    throw new ValidationError(
      `Invalid date format: "${date}", expected YYYY-MM-DD`,
    );
  }

  if (isFutureDateInKL(date, options?.now)) {
    const today = getTodayInKualaLumpur(options?.now);
    throw new FutureDateError(
      `Date "${date}" is in the future (today in Asia/Kuala_Lumpur is "${today}")`,
    );
  }

  const existing = db
    .select()
    .from(dailySheets)
    .where(eq(dailySheets.date, date))
    .get();

  if (existing) {
    return existing;
  }

  const month = date.slice(0, 7);
  assertMonthNotClosed(month, db);

  try {
    const inserted = db
      .insert(dailySheets)
      .values({
        date,
        cashSen: 0,
        tngSen: 0,
      })
      .returning()
      .get();

    return inserted;
  } catch (err: any) {
    // If concurrent insert occurred, return existing sheet
    if (String(err?.message).includes("UNIQUE")) {
      const found = db
        .select()
        .from(dailySheets)
        .where(eq(dailySheets.date, date))
        .get();
      if (found) return found;
    }
    throw err;
  }
}

/**
 * Fetch a Daily Sheet by exact date string ("YYYY-MM-DD").
 * Returns null if not found.
 */
export function getSheetByDate(
  date: string,
  options?: { db?: Db },
): DailySheet | null {
  const db = options?.db ?? openDb().db;

  if (!isValidDateStr(date)) {
    throw new ValidationError(
      `Invalid date format: "${date}", expected YYYY-MM-DD`,
    );
  }

  const sheet = db
    .select()
    .from(dailySheets)
    .where(eq(dailySheets.date, date))
    .get();

  return sheet ?? null;
}

/**
 * Set Cash Revenue and TnG Revenue for a Daily Sheet.
 * - Amounts must be non-negative sen integers
 * - Month must not be closed
 */
export function setRevenue(
  sheetId: number,
  cashSen: number | bigint,
  tngSen: number | bigint,
  options?: { db?: Db },
): DailySheet {
  const db = options?.db ?? openDb().db;

  const validCash = assertValidSen(cashSen, "Cash Revenue (cashSen)");
  const validTng = assertValidSen(tngSen, "TnG Revenue (tngSen)");

  const sheet = db
    .select()
    .from(dailySheets)
    .where(eq(dailySheets.id, sheetId))
    .get();

  if (!sheet) {
    throw new NotFoundError(`Daily Sheet with id ${sheetId} not found`);
  }

  const month = sheet.date.slice(0, 7);
  assertMonthNotClosed(month, db);

  const updated = db
    .update(dailySheets)
    .set({
      cashSen: Number(validCash),
      tngSen: Number(validTng),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dailySheets.id, sheetId))
    .returning()
    .get();

  return updated;
}

/**
 * Add a Cost Line to a Daily Sheet.
 * - Category must be in CostCategory enum
 * - Note required when category is 'other'
 * - Amount must be non-negative sen integer
 * - Month must not be closed
 * - Updates Daily Sheet's updatedAt timestamp atomically in a single transaction
 */
export function addCostLine(
  sheetId: number,
  amountSen: number | bigint,
  category: CostCategory,
  note?: string | null,
  options?: { db?: Db },
): CostLine {
  const db = options?.db ?? openDb().db;

  const validAmount = assertValidSen(
    amountSen,
    "Daily Cost amount (amountSen)",
  );

  if (!isValidCostCategory(category)) {
    throw new ValidationError(
      `Invalid Cost Category: "${String(category)}". Must be one of: ${COST_CATEGORIES.join(", ")}`,
    );
  }

  const trimmedNote = note?.trim() || null;
  if (category === "other" && !trimmedNote) {
    throw new ValidationError("Note is required when Cost Category is 'other'");
  }

  const sheet = db
    .select()
    .from(dailySheets)
    .where(eq(dailySheets.id, sheetId))
    .get();

  if (!sheet) {
    throw new NotFoundError(`Daily Sheet with id ${sheetId} not found`);
  }

  const month = sheet.date.slice(0, 7);
  assertMonthNotClosed(month, db);

  return db.transaction((tx) => {
    const inserted = tx
      .insert(costLines)
      .values({
        dailySheetId: sheetId,
        amountSen: Number(validAmount),
        category,
        note: trimmedNote,
      })
      .returning()
      .get();

    // Keep updatedAt timestamp trail on parent Daily Sheet (no hard delete of sheet)
    tx.update(dailySheets)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(dailySheets.id, sheetId))
      .run();

    return inserted;
  });
}

export interface UpdateCostLineInput {
  amountSen?: number | bigint;
  category?: CostCategory;
  note?: string | null;
}

/**
 * Update an existing Cost Line.
 * - Month must not be closed
 * - Corrections keep timestamps on parent Daily Sheet atomically in a single transaction
 */
export function updateCostLine(
  costLineId: number,
  updates: UpdateCostLineInput,
  options?: { db?: Db },
): CostLine {
  const db = options?.db ?? openDb().db;

  const existingLine = db
    .select()
    .from(costLines)
    .where(eq(costLines.id, costLineId))
    .get();

  if (!existingLine) {
    throw new NotFoundError(`Cost Line with id ${costLineId} not found`);
  }

  const sheet = db
    .select()
    .from(dailySheets)
    .where(eq(dailySheets.id, existingLine.dailySheetId))
    .get();

  if (!sheet) {
    throw new NotFoundError(
      `Daily Sheet with id ${existingLine.dailySheetId} not found`,
    );
  }

  const month = sheet.date.slice(0, 7);
  assertMonthNotClosed(month, db);

  const finalCategory =
    updates.category !== undefined
      ? updates.category
      : (existingLine.category as CostCategory);

  if (!isValidCostCategory(finalCategory)) {
    throw new ValidationError(
      `Invalid Cost Category: "${String(finalCategory)}". Must be one of: ${COST_CATEGORIES.join(", ")}`,
    );
  }

  let finalAmountSen = existingLine.amountSen;
  if (updates.amountSen !== undefined) {
    finalAmountSen = Number(
      assertValidSen(updates.amountSen, "Daily Cost amount (amountSen)"),
    );
  }

  let finalNote: string | null;
  if (updates.note !== undefined) {
    finalNote = updates.note?.trim() || null;
  } else {
    finalNote = existingLine.note;
  }

  if (finalCategory === "other" && !finalNote) {
    throw new ValidationError("Note is required when Cost Category is 'other'");
  }

  return db.transaction((tx) => {
    const updatedLine = tx
      .update(costLines)
      .set({
        amountSen: finalAmountSen,
        category: finalCategory,
        note: finalNote,
      })
      .where(eq(costLines.id, costLineId))
      .returning()
      .get();

    // Keep updatedAt timestamp trail on parent Daily Sheet
    tx.update(dailySheets)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(dailySheets.id, sheet.id))
      .run();

    return updatedLine;
  });
}

/**
 * Remove a Cost Line from a Daily Sheet.
 * - Month must not be closed
 * - Daily Sheet is NOT hard deleted; updates parent updatedAt timestamp atomically in a single transaction
 */
export function removeCostLine(
  costLineId: number,
  options?: { db?: Db },
): { success: boolean; removedLine: CostLine } {
  const db = options?.db ?? openDb().db;

  const existingLine = db
    .select()
    .from(costLines)
    .where(eq(costLines.id, costLineId))
    .get();

  if (!existingLine) {
    throw new NotFoundError(`Cost Line with id ${costLineId} not found`);
  }

  const sheet = db
    .select()
    .from(dailySheets)
    .where(eq(dailySheets.id, existingLine.dailySheetId))
    .get();

  if (!sheet) {
    throw new NotFoundError(
      `Daily Sheet with id ${existingLine.dailySheetId} not found`,
    );
  }

  const month = sheet.date.slice(0, 7);
  assertMonthNotClosed(month, db);

  return db.transaction((tx) => {
    tx.delete(costLines).where(eq(costLines.id, costLineId)).run();

    // Keep updatedAt timestamp trail on parent Daily Sheet
    tx.update(dailySheets)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(dailySheets.id, sheet.id))
      .run();

    return { success: true, removedLine: existingLine };
  });
}

/**
 * Get Daily Sheet by date with its Cost Lines and computed totals.
 * - Uses Money helpers (sumSen, subSen) for arithmetic (no floats)
 * - Returns null if no sheet exists for the given date
 */
export function getSheetWithCosts(
  date: string,
  options?: { db?: Db },
): DailySheetWithCosts | null {
  const db = options?.db ?? openDb().db;

  if (!isValidDateStr(date)) {
    throw new ValidationError(
      `Invalid date format: "${date}", expected YYYY-MM-DD`,
    );
  }

  const sheet = db
    .select()
    .from(dailySheets)
    .where(eq(dailySheets.date, date))
    .get();

  if (!sheet) {
    return null;
  }

  const lines = db
    .select()
    .from(costLines)
    .where(eq(costLines.dailySheetId, sheet.id))
    .orderBy(costLines.id)
    .all();

  const totalCostSen = sumSen(lines.map((l) => BigInt(l.amountSen)));
  const totalRevenueSen = sumSen([BigInt(sheet.cashSen), BigInt(sheet.tngSen)]);
  const grossProfitSen = subSen(totalRevenueSen, totalCostSen);

  return {
    sheet,
    costLines: lines,
    totalCostSen,
    totalRevenueSen,
    grossProfitSen,
  };
}
