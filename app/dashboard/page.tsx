import React from "react";
import {
  getCashTngSplit,
  getCostByCategory,
  getDailyTrend,
  getMonthTile,
  listMonthTiles,
  type CostByCategory,
  type DailyTrendRow,
  type MonthTile,
} from "@/services/dashboard";
import { getTodayInKualaLumpur } from "@/services/daily-sheet";
import { isValidMonthStr } from "@/lib/money";
import {
  DashboardView,
  type SerializedMonthTile,
  type SerializedDailyTrendRow,
  type SerializedCostByCategory,
} from "@/components/DashboardView";

interface PageProps {
  searchParams?: Promise<{ month?: string }>;
}

export default async function DashboardPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const requestedMonth =
    typeof searchParams?.month === "string" ? searchParams.month : undefined;

  let rawTiles: MonthTile[] = [];
  let loadError: string | null = null;

  try {
    rawTiles = await listMonthTiles();
  } catch (err) {
    console.error("Failed to load month tiles for dashboard:", err);
    loadError = "Failed to load dashboard data. Please refresh or try again later.";
  }

  const currentMonthInKL = getTodayInKualaLumpur().slice(0, 7);

  // Active month: requested valid month, or first existing non-future month tile, or current month
  let activeMonth =
    requestedMonth && isValidMonthStr(requestedMonth)
      ? requestedMonth
      : rawTiles.find((t) => t.month <= currentMonthInKL)?.month ?? currentMonthInKL;

  // Disallow future months: clamp to current month in KL
  if (activeMonth > currentMonthInKL) {
    activeMonth = currentMonthInKL;
  }

  let activeTile: MonthTile | null = null;
  let trend: DailyTrendRow[] = [];
  let split = { cashSen: 0n, tngSen: 0n, totalSen: 0n };
  let costByCategory: CostByCategory = {
    restock: 0n,
    gas: 0n,
    transport: 0n,
    "wages-daily": 0n,
    maintenance: 0n,
    other: 0n,
  };

  if (!loadError) {
    try {
      [activeTile, trend, split, costByCategory] = await Promise.all([
        getMonthTile(activeMonth),
        getDailyTrend(activeMonth),
        getCashTngSplit(activeMonth),
        getCostByCategory(activeMonth),
      ]);
    } catch (err) {
      console.error(`Failed to load dashboard data for ${activeMonth}:`, err);
      loadError = "Failed to load dashboard data. Please refresh or try again later.";
    }
  }

  // Filter month tiles to only months up to current KL month (filter out future months)
  const validTiles = rawTiles.filter((t) => t.month <= currentMonthInKL);

  // Ensure activeMonth is in tiles list even if empty
  const hasActiveMonthInTiles = validTiles.some((t) => t.month === activeMonth);
  const effectiveTiles = hasActiveMonthInTiles
    ? validTiles
    : [
        ...(activeTile ? [activeTile] : []),
        ...validTiles,
      ];

  const serializedTiles: SerializedMonthTile[] = effectiveTiles.map((t) => ({
    month: t.month,
    revenueSen: Number(t.revenueSen),
    dailyCostSen: Number(t.dailyCostSen),
    grossSen: Number(t.grossSen),
    operatingSen: Number(t.operatingSen),
    netSen: Number(t.netSen),
    status: t.status,
    balanced: Boolean(t.balanced),
  }));

  const serializedActiveTile: SerializedMonthTile | null = activeTile
    ? {
        month: activeTile.month,
        revenueSen: Number(activeTile.revenueSen),
        dailyCostSen: Number(activeTile.dailyCostSen),
        grossSen: Number(activeTile.grossSen),
        operatingSen: Number(activeTile.operatingSen),
        netSen: Number(activeTile.netSen),
        status: activeTile.status,
        balanced: Boolean(activeTile.balanced),
      }
    : null;

  const serializedTrend: SerializedDailyTrendRow[] = trend.map((r) => ({
    date: r.date,
    cashSen: Number(r.cashSen),
    tngSen: Number(r.tngSen),
    totalSen: Number(r.totalSen),
  }));

  const serializedCostByCategory: SerializedCostByCategory = {
    restock: Number(costByCategory.restock),
    gas: Number(costByCategory.gas),
    transport: Number(costByCategory.transport),
    "wages-daily": Number(costByCategory["wages-daily"]),
    maintenance: Number(costByCategory.maintenance),
    other: Number(costByCategory.other),
  };

  return (
    <DashboardView
      tiles={serializedTiles}
      activeMonth={activeMonth}
      activeTile={serializedActiveTile}
      trend={serializedTrend}
      split={
        loadError
          ? null
          : {
              cashSen: Number(split.cashSen),
              tngSen: Number(split.tngSen),
              totalSen: Number(split.totalSen),
            }
      }
      costByCategory={loadError ? null : serializedCostByCategory}
      loadError={loadError}
    />
  );
}
