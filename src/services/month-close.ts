import { desc, eq, like } from "drizzle-orm";
import { openDb, type Db } from "@/db";
import {
  dailySheets,
  monthCloses,
  type MonthClose,
} from "@/db/schema";
import { isValidMonthStr, subSen, sumSen } from "@/lib/money";
import {
  assertValidSen,
  ClosedMonthError,
  FutureDateError,
  getTodayInKualaLumpur,
  NotFoundError,
  ValidationError,
} from "./daily-sheet";
import { getMonthPreview } from "./operating-expense";

export {
  ClosedMonthError,
  FutureDateError,
  NotFoundError,
  ValidationError,
} from "./daily-sheet";

export class ForbiddenError extends Error {
  constructor(
    message: string = "Forbidden: Admin role required to reopen a closed month",
  ) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Check whether a month ("YYYY-MM") is in the future in Asia/Kuala_Lumpur wall time.
 */
export function isFutureMonthInKL(
  month: string,
  now: Date = new Date(),
): boolean {
  const currentMonth = getTodayInKualaLumpur(now).slice(0, 7);
  return month > currentMonth;
}

export interface CloseMonthOptions {
  confirmEmpty?: boolean;
  db?: Db;
  now?: Date;
}

export interface ReopenMonthOptions {
  role?: string;
  db?: Db;
  now?: Date;
}

export interface MonthCloseWithReconciliation extends MonthClose {
  close: MonthClose;
  expectedSen: bigint;
  actualSen: bigint;
  differenceSen: bigint;
  balanced: boolean;
  warning?: string;
}

export interface MonthCloseHistoryItem extends MonthClose {
  expectedSen: bigint;
  actualSen: bigint;
  differenceSen: bigint;
  balanced: boolean;
}

/**
 * Close a month (Month Close + Reconciliation).
 * - month must be valid YYYY-MM
 * - month must NOT be in the future (Asia/Kuala_Lumpur)
 * - month must not already be closed (unique close per month)
 * - snapshot computed live from current data: revenueSen, dailyCostSen, grossSen, operatingSen, netSen
 * - reject if month has no daily sheets UNLESS confirmEmpty=true
 * - reconciliation: expected = netSen; actual = cashOnHandSen + tngOnHandSen
 *   mismatch is WARN ONLY (does not block), but note is REQUIRED on mismatch
 * - stores snapshot, reconciliation inputs, note, and closedAt
 */
export async function closeMonth(
  month: string,
  cashOnHandSen: number | bigint,
  tngOnHandSen: number | bigint,
  note?: string | null,
  optionsOrConfirmEmpty?: boolean | CloseMonthOptions,
): Promise<MonthCloseWithReconciliation> {
  const options: CloseMonthOptions =
    typeof optionsOrConfirmEmpty === "boolean"
      ? { confirmEmpty: optionsOrConfirmEmpty }
      : (optionsOrConfirmEmpty ?? {});

  const db = options.db ?? openDb().db;

  if (!isValidMonthStr(month)) {
    throw new ValidationError(
      `Invalid month format: "${month}", expected YYYY-MM`,
    );
  }

  if (isFutureMonthInKL(month, options.now)) {
    const currentMonth = getTodayInKualaLumpur(options.now).slice(0, 7);
    throw new FutureDateError(
      `Month "${month}" is in the future (current month in Asia/Kuala_Lumpur is "${currentMonth}")`,
    );
  }

  // Check if already closed
  const existing = db
    .select()
    .from(monthCloses)
    .where(eq(monthCloses.month, month))
    .get();

  if (existing && !existing.reopenedAt) {
    throw new ClosedMonthError(`Month "${month}" is already closed`);
  }

  // Check for daily sheets in month
  const sheetsInMonth = db
    .select({ id: dailySheets.id })
    .from(dailySheets)
    .where(like(dailySheets.date, `${month}-%`))
    .all();

  if (sheetsInMonth.length === 0 && !options.confirmEmpty) {
    throw new ValidationError(
      `Month "${month}" has zero Daily Sheets. Set confirmEmpty=true to close an empty month.`,
    );
  }

  // Validate sen amounts (integer sen, non-negative, no floats)
  const validCashOnHand = assertValidSen(
    cashOnHandSen,
    "Cash on hand (cashOnHandSen)",
  );
  const validTngOnHand = assertValidSen(
    tngOnHandSen,
    "TnG on hand (tngOnHandSen)",
  );

  // Live snapshot computation from current data
  const preview = await getMonthPreview(month, { db });

  // Reconciliation: expected = netSen; actual = cashOnHandSen + tngOnHandSen
  const expectedSen = preview.netSen;
  const actualSen = sumSen([validCashOnHand, validTngOnHand]);
  const differenceSen = subSen(actualSen, expectedSen);
  const balanced = differenceSen === 0n;

  const trimmedNote = note?.trim() || null;

  // On mismatch -> WARN ONLY (do not block), but note is REQUIRED
  if (!balanced && !trimmedNote) {
    throw new ValidationError(
      `A note is required when Reconciliation has a mismatch (expected: ${expectedSen.toString()} sen, actual: ${actualSen.toString()} sen, difference: ${differenceSen.toString()} sen)`,
    );
  }

  const warning = !balanced
    ? `Reconciliation mismatch: expected ${expectedSen.toString()} sen, actual ${actualSen.toString()} sen (difference: ${differenceSen.toString()} sen)`
    : undefined;

  const closedAtTimestamp = (options.now ?? new Date()).toISOString();

  let closeRecord: MonthClose;

  if (existing && existing.reopenedAt) {
    // Re-closing a previously reopened month: update existing record and reset reopened fields
    closeRecord = db
      .update(monthCloses)
      .set({
        revenueSen: Number(preview.revenueSen),
        dailyCostSen: Number(preview.dailyCostSen),
        grossSen: Number(preview.grossSen),
        operatingSen: Number(preview.operatingSen),
        netSen: Number(preview.netSen),
        cashOnHandSen: Number(validCashOnHand),
        tngOnHandSen: Number(validTngOnHand),
        note: trimmedNote,
        closedAt: closedAtTimestamp,
        reopenedAt: null,
        reopenReason: null,
      })
      .where(eq(monthCloses.id, existing.id))
      .returning()
      .get();
  } else {
    try {
      closeRecord = db
        .insert(monthCloses)
        .values({
          month,
          revenueSen: Number(preview.revenueSen),
          dailyCostSen: Number(preview.dailyCostSen),
          grossSen: Number(preview.grossSen),
          operatingSen: Number(preview.operatingSen),
          netSen: Number(preview.netSen),
          cashOnHandSen: Number(validCashOnHand),
          tngOnHandSen: Number(validTngOnHand),
          note: trimmedNote,
          closedAt: closedAtTimestamp,
        })
        .returning()
        .get();
    } catch (err: any) {
      if (String(err?.message).includes("UNIQUE")) {
        throw new ClosedMonthError(`Month "${month}" is already closed`);
      }
      throw err;
    }
  }

  return {
    ...closeRecord,
    close: closeRecord,
    expectedSen,
    actualSen,
    differenceSen,
    balanced,
    ...(warning ? { warning } : {}),
  };
}

/**
 * Reopen a closed month.
 * - Admin-only: caller passes role; asserts role === 'Admin'
 * - Sets reopenedAt + reopenReason on the close row
 * - After reopen, edits to Daily Sheets and Operating Expenses are allowed again
 */
export async function reopenMonth(
  month: string,
  reason: string,
  roleOrOptions?: string | ReopenMonthOptions,
  maybeOptions?: ReopenMonthOptions,
): Promise<MonthClose> {
  const role =
    typeof roleOrOptions === "string"
      ? roleOrOptions
      : (roleOrOptions?.role ?? "");
  const options: ReopenMonthOptions =
    typeof roleOrOptions === "object"
      ? roleOrOptions
      : (maybeOptions ?? {});

  const db = options.db ?? openDb().db;

  if (role !== "Admin") {
    throw new ForbiddenError(
      "Forbidden: Admin role required to reopen a closed month",
    );
  }

  if (!isValidMonthStr(month)) {
    throw new ValidationError(
      `Invalid month format: "${month}", expected YYYY-MM`,
    );
  }

  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    throw new ValidationError("A reason is required to reopen a closed month");
  }

  const existing = db
    .select()
    .from(monthCloses)
    .where(eq(monthCloses.month, month))
    .get();

  if (!existing) {
    throw new NotFoundError(`Month close not found for month: "${month}"`);
  }

  if (existing.reopenedAt) {
    throw new ValidationError(
      `Month "${month}" is already open (reopened at ${existing.reopenedAt})`,
    );
  }

  const reopenedAtTimestamp = (options.now ?? new Date()).toISOString();

  const updated = db
    .update(monthCloses)
    .set({
      reopenedAt: reopenedAtTimestamp,
      reopenReason: trimmedReason,
    })
    .where(eq(monthCloses.id, existing.id))
    .returning()
    .get();

  return updated;
}

/**
 * Return close snapshot + reconciliation result (balanced boolean, differenceSen).
 * Returns null if the month has not been closed.
 */
export async function getClose(
  month: string,
  options?: { db?: Db },
): Promise<MonthCloseWithReconciliation | null> {
  const db = options?.db ?? openDb().db;

  if (!isValidMonthStr(month)) {
    throw new ValidationError(
      `Invalid month format: "${month}", expected YYYY-MM`,
    );
  }

  const close = db
    .select()
    .from(monthCloses)
    .where(eq(monthCloses.month, month))
    .get();

  if (!close) {
    return null;
  }

  const cashOnHand = BigInt(close.cashOnHandSen ?? 0);
  const tngOnHand = BigInt(close.tngOnHandSen ?? 0);
  const actualSen = sumSen([cashOnHand, tngOnHand]);
  const expectedSen = BigInt(close.netSen);
  const differenceSen = subSen(actualSen, expectedSen);
  const balanced = differenceSen === 0n;

  return {
    ...close,
    close,
    expectedSen,
    actualSen,
    differenceSen,
    balanced,
    ...(balanced
      ? {}
      : {
          warning: `Reconciliation mismatch: expected ${expectedSen.toString()} sen, actual ${actualSen.toString()} sen (difference: ${differenceSen.toString()} sen)`,
        }),
  };
}

/**
 * History per month with diffs (at minimum: month, netSen, balanced, closedAt, reopenedAt).
 * Ordered by month descending.
 */
export async function listCloses(
  options?: { db?: Db },
): Promise<MonthCloseHistoryItem[]> {
  const db = options?.db ?? openDb().db;

  const rows = db
    .select()
    .from(monthCloses)
    .orderBy(desc(monthCloses.month))
    .all();

  return rows.map((row) => {
    const cashOnHand = BigInt(row.cashOnHandSen ?? 0);
    const tngOnHand = BigInt(row.tngOnHandSen ?? 0);
    const actualSen = sumSen([cashOnHand, tngOnHand]);
    const expectedSen = BigInt(row.netSen);
    const differenceSen = subSen(actualSen, expectedSen);
    const balanced = differenceSen === 0n;

    return {
      ...row,
      expectedSen,
      actualSen,
      differenceSen,
      balanced,
    };
  });
}
