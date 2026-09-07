import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/auth/guard";
import { openDb } from "@/db";
import {
  getCashTngSplit,
  getCostByCategory,
  getDailyTrend,
  getMonthTile,
  hasMonthData,
  listMonthTiles,
  type CashTngSplit,
  type CostByCategory,
  type DailyTrendRow,
  type MonthTile,
} from "@/services/dashboard";
import { handleError } from "@/services/errors";
import { isValidMonthStr } from "@/lib/money";

function formatTile(tile: MonthTile) {
  return {
    month: tile.month,
    revenueSen: Number(tile.revenueSen),
    dailyCostSen: Number(tile.dailyCostSen),
    grossSen: Number(tile.grossSen),
    operatingSen: Number(tile.operatingSen),
    netSen: Number(tile.netSen),
    status: tile.status,
    ...(tile.balanced !== undefined ? { balanced: tile.balanced } : {}),
  };
}

function formatTrend(trend: DailyTrendRow[]) {
  return trend.map((row) => ({
    date: row.date,
    cashSen: Number(row.cashSen),
    tngSen: Number(row.tngSen),
    totalSen: Number(row.totalSen),
  }));
}

function formatSplit(split: CashTngSplit) {
  return {
    cashSen: Number(split.cashSen),
    tngSen: Number(split.tngSen),
    totalSen: Number(split.totalSen),
  };
}

function formatCostByCategory(costByCategory: CostByCategory) {
  return {
    restock: Number(costByCategory.restock),
    gas: Number(costByCategory.gas),
    transport: Number(costByCategory.transport),
    "wages-daily": Number(costByCategory["wages-daily"]),
    other: Number(costByCategory.other),
  };
}

/**
 * GET /api/dashboard
 * - With ?month=YYYY-MM: returns tile, trend, split, costByCategory for that month.
 * - Without month: returns listMonthTiles.
 */
export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month");

    if (month !== null && month !== undefined && month.trim() !== "") {
      const trimmedMonth = month.trim();
      if (!isValidMonthStr(trimmedMonth)) {
        return NextResponse.json(
          { error: `Invalid month format: "${trimmedMonth}", expected YYYY-MM` },
          { status: 400 },
        );
      }

      const { db } = openDb();
      if (!hasMonthData(trimmedMonth, { db })) {
        return NextResponse.json(
          { error: `Dashboard data not found for month: ${trimmedMonth}` },
          { status: 404 },
        );
      }

      const [tile, trend, split, costByCategory] = await Promise.all([
        getMonthTile(trimmedMonth, { db }),
        getDailyTrend(trimmedMonth, { db }),
        getCashTngSplit(trimmedMonth, { db }),
        getCostByCategory(trimmedMonth, { db }),
      ]);

      return NextResponse.json(
        {
          tile: formatTile(tile),
          trend: formatTrend(trend),
          split: formatSplit(split),
          costByCategory: formatCostByCategory(costByCategory),
        },
        { status: 200 },
      );
    }

    const { db } = openDb();
    const tiles = await listMonthTiles({ db });

    return NextResponse.json(
      {
        tiles: tiles.map(formatTile),
      },
      { status: 200 },
    );
  } catch (err) {
    return handleError(err);
  }
});
