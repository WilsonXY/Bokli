import { asc, desc, eq, like } from "drizzle-orm";
import { openDb, type Db } from "@/db";
import {
  costLines,
  dailySheets,
  monthCloses,
  operatingExpenses,
} from "@/db/schema";
import { isValidMonthStr, subSen, sumSen } from "@/lib/money";
import {
  COST_CATEGORIES,
  type CostCategory,
  NotFoundError,
  ValidationError,
} from "./daily-sheet";
import { getMonthPreview } from "./operating-expense";

export { NotFoundError, ValidationError } from "./daily-sheet";

export type MonthStatus = "open" | "closed" | "reopened";

export interface MonthTile {
  month: string;
  revenueSen: bigint;
  dailyCostSen: bigint;
  grossSen: bigint;
  operatingSen: bigint;
  netSen: bigint;
  status: MonthStatus;
  balanced?: boolean;
}

export interface DailyTrendRow {
  date: string;
  cashSen: bigint;
  tngSen: bigint;
  totalSen: bigint;
}

export interface CashTngSplit {
  cashSen: bigint;
  tngSen: bigint;
  totalSen: bigint;
}

export type CostByCategory = Record<CostCategory, bigint>;

export interface DashboardMonthData {
  tile: MonthTile;
  trend: DailyTrendRow[];
  split: CashTngSplit;
  costByCategory: CostByCategory;
}

/**
 * Checks if there is any bookkeeping activity recorded for a given month
 * across Daily Sheets, Operating Expenses, or Month Closes.
 */
export function hasMonthData(month: string, options?: { db?: Db }): boolean {
  const db = options?.db ?? openDb().db;

  const sheet = db
    .select({ id: dailySheets.id })
    .from(dailySheets)
    .where(like(dailySheets.date, `${month}-%`))
    .limit(1)
    .get();
  if (sheet) return true;

  const expense = db
    .select({ id: operatingExpenses.id })
    .from(operatingExpenses)
    .where(eq(operatingExpenses.month, month))
    .limit(1)
    .get();
  if (expense) return true;

  const close = db
    .select({ id: monthCloses.id })
    .from(monthCloses)
    .where(eq(monthCloses.month, month))
    .limit(1)
    .get();
  if (close) return true;

  return false;
}

/**
 * Get Month Tile for a month.
 * - revenueSen (cash+tng)
 * - dailyCostSen
 * - grossSen (revenueSen - dailyCostSen)
 * - operatingSen
 * - netSen (grossSen - operatingSen)
 * - status: "open" | "closed" | "reopened"
 * - balanced: boolean if closed (actualSen === netSen)
 *
 * Reuses getMonthPreview for open/reopened calculations and month_closes snapshot for closed months.
 * Pure integer sen arithmetic via Money helpers.
 */
export async function getMonthTile(
  month: string,
  options?: { db?: Db },
): Promise<MonthTile> {
  const db = options?.db ?? openDb().db;

  if (!isValidMonthStr(month)) {
    throw new ValidationError(
      `Invalid month format: "${month}", expected YYYY-MM`,
    );
  }

  const closeRecord = db
    .select()
    .from(monthCloses)
    .where(eq(monthCloses.month, month))
    .get();

  if (closeRecord && !closeRecord.reopenedAt) {
    // Month is closed: use frozen snapshot and evaluate balanced
    const netSen = BigInt(closeRecord.netSen);
    const cashOnHand = BigInt(closeRecord.cashOnHandSen ?? 0);
    const tngOnHand = BigInt(closeRecord.tngOnHandSen ?? 0);
    const actualSen = sumSen([cashOnHand, tngOnHand]);
    const differenceSen = subSen(actualSen, netSen);
    const balanced = differenceSen === 0n;

    return {
      month,
      revenueSen: BigInt(closeRecord.revenueSen),
      dailyCostSen: BigInt(closeRecord.dailyCostSen),
      grossSen: BigInt(closeRecord.grossSen),
      operatingSen: BigInt(closeRecord.operatingSen),
      netSen,
      status: "closed",
      balanced,
    };
  }

  // Month is open or reopened: compute live preview from current data
  const preview = await getMonthPreview(month, { db });
  const status: MonthStatus = closeRecord?.reopenedAt ? "reopened" : "open";

  return {
    month,
    revenueSen: preview.revenueSen,
    dailyCostSen: preview.dailyCostSen,
    grossSen: preview.grossSen,
    operatingSen: preview.operatingSen,
    netSen: preview.netSen,
    status,
  };
}

/**
 * Get Daily Trend across Daily Sheets in month (Asia/Kuala_Lumpur wall dates).
 * Returns per-date cashSen, tngSen, totalSen ordered chronologically by date.
 */
export async function getDailyTrend(
  month: string,
  options?: { db?: Db },
): Promise<DailyTrendRow[]> {
  const db = options?.db ?? openDb().db;

  if (!isValidMonthStr(month)) {
    throw new ValidationError(
      `Invalid month format: "${month}", expected YYYY-MM`,
    );
  }

  const sheets = db
    .select({
      date: dailySheets.date,
      cashSen: dailySheets.cashSen,
      tngSen: dailySheets.tngSen,
    })
    .from(dailySheets)
    .where(like(dailySheets.date, `${month}-%`))
    .orderBy(asc(dailySheets.date))
    .all();

  return sheets.map((s) => {
    const cashSen = BigInt(s.cashSen);
    const tngSen = BigInt(s.tngSen);
    const totalSen = sumSen([cashSen, tngSen]);
    return {
      date: s.date,
      cashSen,
      tngSen,
      totalSen,
    };
  });
}

/**
 * Get Cash versus TnG Revenue Split for a month.
 * Totals cashSen vs tngSen across all Daily Sheets in month.
 */
export async function getCashTngSplit(
  month: string,
  options?: { db?: Db },
): Promise<CashTngSplit> {
  const db = options?.db ?? openDb().db;

  if (!isValidMonthStr(month)) {
    throw new ValidationError(
      `Invalid month format: "${month}", expected YYYY-MM`,
    );
  }

  const sheets = db
    .select({
      cashSen: dailySheets.cashSen,
      tngSen: dailySheets.tngSen,
    })
    .from(dailySheets)
    .where(like(dailySheets.date, `${month}-%`))
    .all();

  const cashSen = sumSen(sheets.map((s) => BigInt(s.cashSen)));
  const tngSen = sumSen(sheets.map((s) => BigInt(s.tngSen)));
  const totalSen = sumSen([cashSen, tngSen]);

  return {
    cashSen,
    tngSen,
    totalSen,
  };
}

/**
 * Get Daily Cost breakdown by Cost Category enum for a month.
 * Categories: restock, gas, transport, wages-daily, other.
 */
export async function getCostByCategory(
  month: string,
  options?: { db?: Db },
): Promise<CostByCategory> {
  const db = options?.db ?? openDb().db;

  if (!isValidMonthStr(month)) {
    throw new ValidationError(
      `Invalid month format: "${month}", expected YYYY-MM`,
    );
  }

  const costs = db
    .select({
      category: costLines.category,
      amountSen: costLines.amountSen,
    })
    .from(costLines)
    .innerJoin(dailySheets, eq(costLines.dailySheetId, dailySheets.id))
    .where(like(dailySheets.date, `${month}-%`))
    .all();

  const sums: CostByCategory = {
    restock: 0n,
    gas: 0n,
    transport: 0n,
    "wages-daily": 0n,
    other: 0n,
  };

  for (const c of costs) {
    const cat = c.category as CostCategory;
    if (cat in sums) {
      sums[cat] = sumSen([sums[cat], BigInt(c.amountSen)]);
    }
  }

  return sums;
}

/**
 * List recent Month Tiles.
 * Discovers distinct months with bookkeeping records (Daily Sheets, Operating Expenses, Month Closes),
 * ordered newest first.
 * @param upTo Optional limit or filter: number of recent months, or upper bound month string "YYYY-MM", or options object.
 */
export async function listMonthTiles(
  upTo?: number | string | { limit?: number; upToMonth?: string; db?: Db },
  options?: { db?: Db },
): Promise<MonthTile[]> {
  let limit: number | undefined;
  let upToMonth: string | undefined;
  let db: Db;

  if (typeof upTo === "number") {
    limit = upTo;
    db = options?.db ?? openDb().db;
  } else if (typeof upTo === "string") {
    if (isValidMonthStr(upTo)) {
      upToMonth = upTo;
    } else if (/^\d+$/.test(upTo.trim())) {
      limit = Number(upTo.trim());
    }
    db = options?.db ?? openDb().db;
  } else if (typeof upTo === "object" && upTo !== null) {
    limit = upTo.limit;
    upToMonth = upTo.upToMonth;
    db = upTo.db ?? options?.db ?? openDb().db;
  } else {
    db = options?.db ?? openDb().db;
  }

  // Query distinct months from dailySheets, operatingExpenses, and monthCloses
  const sheetRows = db
    .select({ date: dailySheets.date })
    .from(dailySheets)
    .all();

  const expenseRows = db
    .select({ month: operatingExpenses.month })
    .from(operatingExpenses)
    .all();

  const closeRows = db
    .select({ month: monthCloses.month })
    .from(monthCloses)
    .all();

  const monthsSet = new Set<string>();
  for (const r of sheetRows) {
    if (r.date.length >= 7) {
      monthsSet.add(r.date.slice(0, 7));
    }
  }
  for (const r of expenseRows) {
    monthsSet.add(r.month);
  }
  for (const r of closeRows) {
    monthsSet.add(r.month);
  }

  let months = Array.from(monthsSet).sort().reverse();

  if (upToMonth) {
    months = months.filter((m) => m <= upToMonth);
  }

  if (limit !== undefined && limit > 0) {
    months = months.slice(0, limit);
  }

  const tiles: MonthTile[] = [];
  for (const m of months) {
    tiles.push(await getMonthTile(m, { db }));
  }

  return tiles;
}

/**
 * Returns all dashboard data for a month:
 * - Month Tile (revenue, cost, gross, opex, net, status, balanced)
 * - Daily Trend
 * - Cash vs TnG Split
 * - Cost by Category
 */
export async function getDashboard(
  month: string,
  options?: { db?: Db },
): Promise<DashboardMonthData> {
  const [tile, trend, split, costByCategory] = await Promise.all([
    getMonthTile(month, options),
    getDailyTrend(month, options),
    getCashTngSplit(month, options),
    getCostByCategory(month, options),
  ]);

  return {
    tile,
    trend,
    split,
    costByCategory,
  };
}
