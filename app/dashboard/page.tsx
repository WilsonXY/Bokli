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

  const rawTiles = await listMonthTiles();
  const currentMonthInKL = getTodayInKualaLumpur().slice(0, 7);

  // Active month: requested month, or first existing month tile, or current month
  const activeMonth =
    requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth)
      ? requestedMonth
      : rawTiles.length > 0
        ? rawTiles[0].month
        : currentMonthInKL;

  let activeTile: MonthTile | null = null;
  let trend: DailyTrendRow[] = [];
  let split = { cashSen: 0n, tngSen: 0n, totalSen: 0n };
  let costByCategory: CostByCategory = {
    restock: 0n,
    gas: 0n,
    transport: 0n,
    "wages-daily": 0n,
    other: 0n,
  };

  try {
    [activeTile, trend, split, costByCategory] = await Promise.all([
      getMonthTile(activeMonth),
      getDailyTrend(activeMonth),
      getCashTngSplit(activeMonth),
      getCostByCategory(activeMonth),
    ]);
  } catch {
    // If month data cannot be loaded, fallback gracefully
  }

  // Ensure activeMonth is in tiles list even if empty
  const hasActiveMonthInTiles = rawTiles.some((t) => t.month === activeMonth);
  const effectiveTiles = hasActiveMonthInTiles
    ? rawTiles
    : [
        ...(activeTile ? [activeTile] : []),
        ...rawTiles,
      ];

  const serializedTiles: SerializedMonthTile[] = effectiveTiles.map((t) => ({
    month: t.month,
    revenueSen: Number(t.revenueSen),
    dailyCostSen: Number(t.dailyCostSen),
    grossSen: Number(t.grossSen),
    operatingSen: Number(t.operatingSen),
    netSen: Number(t.netSen),
    status: t.status,
    balanced: t.balanced,
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
        balanced: activeTile.balanced,
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
    other: Number(costByCategory.other),
  };

  return (
    <DashboardView
      tiles={serializedTiles}
      activeMonth={activeMonth}
      activeTile={serializedActiveTile}
      trend={serializedTrend}
      split={{
        cashSen: Number(split.cashSen),
        tngSen: Number(split.tngSen),
        totalSen: Number(split.totalSen),
      }}
      costByCategory={serializedCostByCategory}
    />
  );
}
