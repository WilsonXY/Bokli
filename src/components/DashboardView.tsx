"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { amountSizeClass } from "@/lib/money";
import type { MonthStatus } from "@/services/dashboard";
import { MonthSelectorDropdown } from "@/components/MonthSelectorDropdown";
import {
  MoneyValue,
  formatCompactMyr,
  formatDisplayMyr,
} from "@/components/MoneyValue";
import {
  COST_CATEGORY_TOKENS,
  CashIcon,
  CostCategoryIcon,
  TngIcon,
  type CostCategoryKey,
} from "@/components/BokliIcons";

export interface SerializedMonthTile {
  month: string;
  revenueSen: number;
  dailyCostSen: number;
  grossSen: number;
  operatingSen: number;
  netSen: number;
  status: MonthStatus;
  balanced?: boolean;
}

export interface SerializedDailyTrendRow {
  date: string;
  cashSen: number;
  tngSen: number;
  totalSen: number;
  costSen: number;
}

export type TrendMetric = "revenue" | "cost";

export function trendValueSen(row: SerializedDailyTrendRow, metric: TrendMetric): number {
  return metric === "revenue" ? row.totalSen : row.costSen;
}

export interface SerializedCostByCategory {
  restock: number;
  gas: number;
  transport: number;
  "wages-daily": number;
  maintenance: number;
  other: number;
}

export interface RankedCostCategory {
  cat: CostCategoryKey;
  amountSen: number;
  pct: number;
  exactShare: number;
}

/**
 * Compute the immediately preceding calendar month ("2026-01" -> "2025-12").
 * Ensures MoM comparison never silently skips unrecorded calendar months.
 */
export function previousCalendarMonth(month: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  if (mo === 1) return `${year - 1}-12`;
  return `${year}-${String(mo - 1).padStart(2, "0")}`;
}

/**
 * Rank non-zero Cost Categories largest-first with exact sen shares and
 * rounded display percentages. Deterministic across server/client renders.
 */
export function buildRankedCostCategories(
  costByCategory: SerializedCostByCategory | null
): RankedCostCategory[] {
  if (!costByCategory) return [];
  const entries = (Object.keys(COST_CATEGORY_TOKENS) as CostCategoryKey[])
    .map((cat) => ({ cat, amountSen: costByCategory[cat] ?? 0 }))
    .filter((e) => e.amountSen > 0);
  const totalSen = entries.reduce((acc, e) => acc + e.amountSen, 0);
  if (totalSen <= 0) return [];

  return entries
    .sort((a, b) => b.amountSen - a.amountSen)
    .map((e) => ({
      cat: e.cat,
      amountSen: e.amountSen,
      exactShare: e.amountSen / totalSen,
      pct: Math.round((e.amountSen / totalSen) * 100),
    }));
}

export interface CalendarBarSlot {
  day: number;
  date: string;
  row: SerializedDailyTrendRow | null;
}

/**
 * Expand recorded daily rows across a calendar-proportional day span so gaps
 * between recorded days remain visually truthful.
 */
export function buildCalendarSlots(
  activeMonth: string,
  trend: SerializedDailyTrendRow[]
): CalendarBarSlot[] {
  if (trend.length === 0) return [];
  const [yStr, mStr] = activeMonth.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const daysInMonth =
    year && month ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 31;

  const byDay = new Map<number, SerializedDailyTrendRow>();
  for (const row of trend) {
    const dayNum = Number(row.date.slice(8, 10));
    if (!Number.isNaN(dayNum)) byDay.set(dayNum, row);
  }

  const days = Array.from(byDay.keys()).sort((a, b) => a - b);
  const minDay = days[0];
  const maxDay = days[days.length - 1];
  const startDay = Math.max(1, Math.min(minDay, daysInMonth - 6));
  const endDay = Math.min(daysInMonth, Math.max(maxDay, startDay + 6));

  const slots: CalendarBarSlot[] = [];
  for (let d = startDay; d <= endDay; d++) {
    const dayPad = String(d).padStart(2, "0");
    slots.push({
      day: d,
      date: `${activeMonth}-${dayPad}`,
      row: byDay.get(d) ?? null,
    });
  }
  return slots;
}

export interface RevenueAllocation {
  isLoss: boolean;
  hasRevenue: boolean;
  revenueSen: number;
  dailyCostSen: number;
  operatingSen: number;
  coveredDailySen: number;
  coveredOpSen: number;
  totalOutflowSen: number;
  dailyOfRevPct: number | null;
  opOfRevPct: number | null;
  netOfRevPct: number | null;
  /** Bar widths summing to 100% on a single consistent scale.
   *  Profitable month: scaled against revenue (daily + op + net = 100%).
   *  Loss month: scaled against total outflow (coveredDaily + coveredOp + shortfall = 100%),
   *  with `revenueMarkPct` marking the exact 100%-revenue boundary. */
  dailyBarWidth: number;
  opBarWidth: number;
  netBarWidth: number;
  shortfallBarWidth: number;
  revenueMarkPct: number | null;
  shortfallSen: number;
}

/**
 * Truthful single-scale revenue/outflow allocation for both profitable and loss months.
 * Keeps Operating Expenses in neutral slate in every month and reserves crimson strictly
 * for the uncovered shortfall past revenue.
 */
export function computeRevenueAllocation(
  tile: SerializedMonthTile | null
): RevenueAllocation | null {
  if (!tile) return null;
  const rev = Math.max(0, tile.revenueSen);
  const daily = Math.max(0, tile.dailyCostSen);
  const op = Math.max(0, tile.operatingSen);
  const totalOutflow = daily + op;
  if (rev <= 0 && totalOutflow <= 0) return null;

  const isLoss = tile.netSen < 0;
  const hasRevenue = rev > 0;
  const dailyOfRevPct = hasRevenue ? Math.round((daily / rev) * 100) : null;
  const opOfRevPct = hasRevenue ? Math.round((op / rev) * 100) : null;
  const netOfRevPct = hasRevenue ? Math.round((tile.netSen / rev) * 100) : null;

  if (isLoss) {
    const denom = totalOutflow > 0 ? totalOutflow : 1;
    const coveredDaily = Math.min(daily, rev);
    const coveredOp = Math.max(0, Math.min(op, rev - coveredDaily));
    const dailyBarWidth = Number(((coveredDaily / denom) * 100).toFixed(1));
    const opBarWidth = Number(((coveredOp / denom) * 100).toFixed(1));
    const shortfallBarWidth = Number(Math.max(0, 100 - dailyBarWidth - opBarWidth).toFixed(1));
    const revenueMarkPct = hasRevenue ? Number(((rev / denom) * 100).toFixed(1)) : null;
    return {
      isLoss: true,
      hasRevenue,
      revenueSen: rev,
      dailyCostSen: daily,
      operatingSen: op,
      coveredDailySen: coveredDaily,
      coveredOpSen: coveredOp,
      totalOutflowSen: totalOutflow,
      dailyOfRevPct,
      opOfRevPct,
      netOfRevPct,
      dailyBarWidth,
      opBarWidth,
      netBarWidth: 0,
      shortfallBarWidth,
      revenueMarkPct,
      shortfallSen: Math.abs(tile.netSen),
    };
  }

  const dailyBarWidth = hasRevenue ? Number(((daily / rev) * 100).toFixed(1)) : 0;
  const opBarWidth = hasRevenue ? Number(((op / rev) * 100).toFixed(1)) : 0;
  const netBarWidth = Number(Math.max(0, 100 - dailyBarWidth - opBarWidth).toFixed(1));

  return {
    isLoss: false,
    hasRevenue,
    revenueSen: rev,
    dailyCostSen: daily,
    operatingSen: op,
    coveredDailySen: daily,
    coveredOpSen: op,
    totalOutflowSen: totalOutflow,
    dailyOfRevPct,
    opOfRevPct,
    netOfRevPct,
    dailyBarWidth,
    opBarWidth,
    netBarWidth,
    shortfallBarWidth: 0,
    revenueMarkPct: null,
    shortfallSen: 0,
  };
}

function formatShortWeekday(dateStr: string, lang: "zh" | "en"): string {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return "";
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const zhDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const enDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return lang === "zh" ? zhDays[dt.getUTCDay()] : enDays[dt.getUTCDay()];
}

interface DashboardViewProps {
  tiles: SerializedMonthTile[];
  activeMonth: string;
  activeTile: SerializedMonthTile | null;
  trend: SerializedDailyTrendRow[];
  split: {
    cashSen: number;
    tngSen: number;
    totalSen: number;
  } | null;
  costByCategory: SerializedCostByCategory | null;
  loadError?: string | null;
}

export function DashboardView({
  tiles,
  activeMonth,
  activeTile,
  trend,
  split,
  costByCategory,
  loadError,
}: DashboardViewProps) {
  const router = useRouter();
  const { t, lang } = useI18n();

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("revenue");

  const categoryLabels = useMemo<Record<CostCategoryKey, string>>(
    () => ({
      restock: t.catRestock,
      gas: t.catGas,
      transport: t.catTransport,
      "wages-daily": t.catWagesDaily,
      maintenance: t.catMaintenance,
      other: t.catOther,
    }),
    [t]
  );

  const isProfitPositive = activeTile ? BigInt(activeTile.netSen) >= 0n : true;

  const netMarginPct =
    activeTile && activeTile.revenueSen > 0
      ? Math.round((activeTile.netSen / activeTile.revenueSen) * 1000) / 10
      : null;

  // Strict adjacent calendar month comparison (never silently skips missing months)
  const previousTile = useMemo(() => {
    const prevKey = previousCalendarMonth(activeMonth);
    if (!prevKey) return null;
    return tiles.find((item) => item.month === prevKey) ?? null;
  }, [tiles, activeMonth]);

  const momDeltaSen =
    activeTile && previousTile
      ? BigInt(activeTile.netSen) - BigInt(previousTile.netSen)
      : null;

  const rankedCosts = useMemo(
    () => buildRankedCostCategories(costByCategory),
    [costByCategory]
  );

  const totalCostsSen = useMemo(
    () => rankedCosts.reduce((acc, item) => acc + item.amountSen, 0),
    [rankedCosts]
  );

  // Single concise localized takeaway via i18n templates (no duplicate margin, no hardcoded prose)
  const insightSentence = useMemo(() => {
    if (!activeTile) return null;
    if (
      activeTile.revenueSen === 0 &&
      activeTile.dailyCostSen === 0 &&
      activeTile.operatingSen === 0
    ) {
      return t.insightEmpty;
    }
    if (activeTile.netSen < 0) {
      return t.insightLossCallout.replace(
        "{loss}",
        formatDisplayMyr(Math.abs(activeTile.netSen))
      );
    }
    const topCost = rankedCosts[0];
    if (topCost && trend.length > 0) {
      return t.insightDaysAndTopCost
        .replace("{days}", String(trend.length))
        .replace("{category}", categoryLabels[topCost.cat])
        .replace("{pct}", String(topCost.pct));
    }
    if (trend.length > 0) {
      return t.insightDaysOnly.replace("{days}", String(trend.length));
    }
    return null;
  }, [activeTile, rankedCosts, trend.length, t, categoryLabels]);

  const allocation = useMemo(
    () => computeRevenueAllocation(activeTile),
    [activeTile]
  );

  const splitTotal = split?.totalSen ?? 0;
  const cashPct = splitTotal > 0 ? Math.round((split!.cashSen / splitTotal) * 100) : 0;
  const tngPct = splitTotal > 0 ? Math.max(0, 100 - cashPct) : 0;

  // Calendar-proportional Daily Bar Chart
  const calendarSlots = useMemo(
    () => buildCalendarSlots(activeMonth, trend),
    [activeMonth, trend]
  );

  const metricValues = useMemo(
    () => trend.map((row) => trendValueSen(row, trendMetric)),
    [trend, trendMetric]
  );

  const rawMaxSen = metricValues.length > 0 ? Math.max(...metricValues, 1000) : 1000;
  const axisMaxSen = Math.ceil((rawMaxSen * 1.1) / 10000) * 10000 || 10000;
  const axisMidSen = Math.round(axisMaxSen / 2);

  const dailyAvgSen =
    metricValues.length > 0
      ? Math.round(metricValues.reduce((a, b) => a + b, 0) / metricValues.length)
      : 0;
  const peakRow = useMemo(() => {
    if (trend.length === 0) return null;
    return trend.reduce((best, curr) =>
      trendValueSen(curr, trendMetric) > trendValueSen(best, trendMetric) ? curr : best
    );
  }, [trend, trendMetric]);

  const inspectedIdx = useMemo(() => {
    if (trend.length === 0) return -1;
    const found = trend.findIndex((r) => r.date === selectedDate);
    return found >= 0 ? found : trend.length - 1;
  }, [trend, selectedDate]);

  const inspectedRow = inspectedIdx >= 0 ? trend[inspectedIdx] : null;

  const trendTabs: Array<{ metric: TrendMetric; label: string }> = [
    { metric: "revenue", label: t.sheetRevCol },
    { metric: "cost", label: t.sheetCostCol },
  ];

  const headlineNetStr = activeTile ? formatDisplayMyr(BigInt(activeTile.netSen)) : "";
  const isSparseTrend = trend.length > 0 && trend.length <= 10;

  return (
    <div className="space-y-5">
      {/* Page Header: Month Selector + Primary Today CTA available at every width (>=44px tap target) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-ink-primary tracking-tight">
          {t.overviewTitle}
        </h1>

        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2">
          <MonthSelectorDropdown
            currentMonth={activeMonth}
            options={tiles.map((tile) => ({
              month: tile.month,
              status: tile.status,
            }))}
            onSelect={(month) => router.push(`/dashboard?month=${month}`)}
          />

          <Link
            href="/"
            aria-label={t.recordTodaySheet}
            className="inline-flex items-center gap-1.5 min-h-[48px] h-12 sm:min-h-[44px] sm:h-11 px-3 sm:px-4 rounded-xl bg-brand-cta hover:bg-brand-cta-hover text-brand-cta-ink text-sm font-semibold btn-tactile shadow-card whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <span className="sm:hidden">{t.recordTodayShort}</span>
            <span className="hidden sm:inline">{t.recordTodaySheet}</span>
          </Link>
        </div>
      </div>

      {loadError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="p-5 rounded-2xl bg-finance-loss-light border border-finance-loss-border text-finance-loss space-y-1.5 shadow-card"
        >
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3 className="text-sm font-bold text-finance-loss">{t.loadError}</h3>
          </div>
          <p className="text-xs text-ink-secondary">{loadError}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* 1. Hero Profit Story & Waterfall Ledger (2-col starting at md:768px for compact tablet fold) */}
          {activeTile && (
            <section
              aria-label="Month Financial Summary"
              className="bg-surface border border-surface-border rounded-2xl shadow-card overflow-hidden grid grid-cols-1 md:grid-cols-12"
            >
              {/* Left 6 Cols: Net Profit Hero + Margin/MoM + Concise Localized Insight */}
              <div className="md:col-span-6 p-5 sm:p-6 flex flex-col justify-start gap-5">
                <div>
                  <div className="flex items-center flex-wrap gap-2">
                    <span className="text-sm font-semibold text-ink-muted">
                      {t.netProfit}
                    </span>
                    {netMarginPct !== null && (
                      <span
                        className={`text-xs font-semibold px-2.5 py-0.5 rounded-full num-tabular ${
                          isProfitPositive
                            ? "bg-finance-profit-light text-finance-profit border border-finance-profit-border"
                            : "bg-finance-loss-light text-finance-loss border border-finance-loss-border"
                        }`}
                      >
                        {t.profitMargin} {netMarginPct}%
                      </span>
                    )}
                    {momDeltaSen !== null && previousTile && (
                      <span
                        className={`text-xs font-semibold px-2.5 py-0.5 rounded-full num-tabular border ${
                          momDeltaSen >= 0n
                            ? "bg-surface-subtle text-finance-profit border-surface-border"
                            : "bg-surface-subtle text-finance-loss border-surface-border"
                        }`}
                      >
                        {momDeltaSen >= 0n ? "↗" : "↘"}{" "}
                        <MoneyValue sen={momDeltaSen} showPlus />{" "}
                        <span className="text-ink-muted font-medium">
                          {t.vsPrevMonth} {previousTile.month}
                        </span>
                      </span>
                    )}
                  </div>

                  <div
                    className={`mt-2.5 ${amountSizeClass(
                      headlineNetStr,
                      "text-3xl",
                      "text-4xl"
                    )} sm:text-[42px] leading-none font-bold tracking-tight ${
                      isProfitPositive ? "text-finance-profit" : "text-finance-loss"
                    }`}
                  >
                    <MoneyValue sen={BigInt(activeTile.netSen)} variant="hero" />
                  </div>
                </div>

                {insightSentence && (
                  <p className="text-[13px] sm:text-sm text-ink-secondary leading-relaxed pt-3 border-t border-surface-border/70">
                    {insightSentence}
                  </p>
                )}
              </div>

              {/* Right 6 Cols: Profit Breakdown Waterfall + Truthful Allocation Bar */}
              <div className="md:col-span-6 p-5 sm:p-6 border-t md:border-t-0 md:border-l border-surface-border bg-surface-subtle/35 flex flex-col justify-between gap-4">
                <div className="space-y-2.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-ink-secondary">
                      <span className="w-2 h-2 rounded-full bg-ink-primary shrink-0" aria-hidden="true" />
                      <span>{t.totalRevenue}</span>
                    </span>
                    <MoneyValue
                      sen={BigInt(activeTile.revenueSen)}
                      className="font-bold text-ink-primary"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-ink-muted">
                      <span className="w-2 h-2 rounded-full bg-finance-cost shrink-0" aria-hidden="true" />
                      <span>{t.costsTitle}</span>
                    </span>
                    <span className="font-semibold text-ink-secondary num-tabular whitespace-nowrap">
                      {activeTile.dailyCostSen > 0 ? "\u2212" : ""}
                      <MoneyValue sen={BigInt(activeTile.dailyCostSen)} />
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-dashed border-surface-border">
                    <span className="font-semibold text-ink-secondary">
                      {t.monthGrossProfit}
                    </span>
                    <MoneyValue
                      sen={BigInt(activeTile.grossSen)}
                      className="font-bold text-ink-primary"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-ink-muted">
                      <span className="w-2 h-2 rounded-full bg-finance-opex shrink-0" aria-hidden="true" />
                      <span>{t.operatingExpenses}</span>
                    </span>
                    <span className="font-semibold text-ink-secondary num-tabular whitespace-nowrap">
                      {activeTile.operatingSen > 0 ? "\u2212" : ""}
                      <MoneyValue sen={BigInt(activeTile.operatingSen)} />
                    </span>
                  </div>
                </div>

                {/* Single-Scale Allocation Bar (Profit: scaled to revenue; Loss: gapless outflow bar with aligned 100%-revenue boundary + covered-amount legend) */}
                {allocation && (
                  <div className="space-y-2 pt-1">
                    {allocation.isLoss && (
                      <div className="text-xs text-ink-muted num-tabular">
                        {(allocation.hasRevenue
                          ? t.shortfallSummaryCaption
                          : t.shortfallZeroRevenueCaption
                        )
                          .replace("{outflow}", formatDisplayMyr(allocation.totalOutflowSen))
                          .replace("{revenue}", formatDisplayMyr(allocation.revenueSen))}
                      </div>
                    )}
                    {allocation.isLoss &&
                      allocation.revenueMarkPct !== null &&
                      allocation.revenueMarkPct > 0 &&
                      allocation.revenueMarkPct < 100 && (
                        <div className="relative h-4 text-[11px] font-semibold text-ink-secondary num-tabular">
                          <span
                            style={{
                              left: `${allocation.revenueMarkPct}%`,
                              transform:
                                allocation.revenueMarkPct > 72
                                  ? "translateX(-100%)"
                                  : allocation.revenueMarkPct < 24
                                    ? "translateX(0%)"
                                    : "translateX(-50%)",
                            }}
                            className="absolute bottom-0 whitespace-nowrap"
                          >
                            {t.revenueMarkLabel} <MoneyValue sen={allocation.revenueSen} />
                          </span>
                        </div>
                      )}
                    <div className="relative py-1">
                      <div
                        className={`w-full h-2.5 rounded-full bg-surface-hover overflow-hidden flex ${
                          allocation.isLoss ? "gap-0" : "gap-0.5"
                        }`}
                      >
                        {allocation.dailyBarWidth > 0 && (
                          <div
                            style={{ width: `${allocation.dailyBarWidth}%` }}
                            className="h-full bg-finance-cost transition-all duration-300"
                            title={
                              allocation.isLoss
                                ? `${
                                    allocation.coveredDailySen < allocation.dailyCostSen
                                      ? t.dailyCostsCoveredLabel
                                      : t.costsTitle
                                  }: ${formatDisplayMyr(allocation.coveredDailySen)}`
                                : `${t.costsTitle}: ${allocation.dailyOfRevPct ?? 0}%`
                            }
                          />
                        )}
                        {allocation.opBarWidth > 0 && (
                          <div
                            style={{ width: `${allocation.opBarWidth}%` }}
                            className="h-full bg-finance-opex transition-all duration-300"
                            title={
                              allocation.isLoss
                                ? `${t.opexCoveredLabel}: ${formatDisplayMyr(allocation.coveredOpSen)}`
                                : `${t.operatingExpenses}: ${allocation.opOfRevPct ?? 0}%`
                            }
                          />
                        )}
                        {allocation.isLoss && allocation.shortfallBarWidth > 0 && (
                          <div
                            style={{ width: `${allocation.shortfallBarWidth}%` }}
                            className="h-full bg-finance-loss transition-all duration-300"
                            title={`${t.shortfallUncoveredLabel}: ${formatDisplayMyr(allocation.shortfallSen)}`}
                          />
                        )}
                        {!allocation.isLoss && allocation.netBarWidth > 0 && (
                          <div
                            style={{ width: `${allocation.netBarWidth}%` }}
                            className="h-full bg-finance-profit transition-all duration-300"
                            title={`${t.netProfit}: ${allocation.netOfRevPct ?? 0}%`}
                          />
                        )}
                      </div>
                      {allocation.isLoss && allocation.revenueMarkPct !== null && allocation.revenueMarkPct > 0 && allocation.revenueMarkPct < 100 && (
                        <span
                          aria-hidden="true"
                          style={{ left: `${allocation.revenueMarkPct}%` }}
                          className="pointer-events-none absolute -top-0.5 -bottom-0.5 w-[2px] rounded-full bg-ink-primary -translate-x-1/2 ring-1 ring-surface"
                        />
                      )}
                    </div>
                    <div
                      className={`flex flex-wrap items-baseline gap-y-1 text-xs text-ink-muted num-tabular ${
                        allocation.isLoss ? "justify-start gap-x-4" : "justify-between gap-x-3"
                      }`}
                    >
                      {(!allocation.isLoss || allocation.coveredDailySen > 0) && (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-finance-cost shrink-0" aria-hidden="true" />
                          {allocation.isLoss ? (
                            <span>
                              {allocation.coveredDailySen < allocation.dailyCostSen
                                ? t.dailyCostsCoveredLabel
                                : t.costsTitle}{" "}
                              <MoneyValue sen={allocation.coveredDailySen} />
                            </span>
                          ) : (
                            <span>
                              {t.costsTitle} {allocation.dailyOfRevPct ?? 0}%
                            </span>
                          )}
                        </span>
                      )}
                      {(!allocation.isLoss || allocation.coveredOpSen > 0) && (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-finance-opex shrink-0" aria-hidden="true" />
                          {allocation.isLoss ? (
                            <span>
                              {t.opexCoveredLabel} <MoneyValue sen={allocation.coveredOpSen} />
                            </span>
                          ) : (
                            <span>
                              {t.operatingExpenses} {allocation.opOfRevPct ?? 0}%
                            </span>
                          )}
                        </span>
                      )}
                      {allocation.isLoss ? (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-finance-loss font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-finance-loss shrink-0" aria-hidden="true" />
                          <span>
                            {t.shortfallUncoveredLabel} <MoneyValue sen={allocation.shortfallSen} />
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-finance-profit font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-finance-profit shrink-0" aria-hidden="true" />
                          <span>
                            {t.netProfit} {allocation.netOfRevPct ?? 0}%
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Mobile-first Action Priority: Daily Sheets immediately after Hero on <md; Analytics Row first on md+ */}
          <div className="flex flex-col gap-5">
            {/* 2. Analytics Bento Row (Order 2 on mobile, Order 1 on md+/desktop) */}
            <div className="order-2 md:order-1 grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              {/* Left 7 Cols: Calendar-Proportional Daily Bar Chart */}
              <section className="lg:col-span-7 bg-surface border border-surface-border rounded-2xl p-5 sm:p-6 shadow-card flex flex-col gap-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <h2 className="text-base font-bold text-ink-primary whitespace-nowrap">
                      {trendMetric === "revenue" ? t.dailyTrend : t.dailyCostTrend}
                    </h2>

                    {/* Segmented Metric Toggle — Always aligns cleanly beside heading on desktop */}
                    <div
                      role="group"
                      aria-label={t.dailyTrend}
                      className="inline-flex rounded-xl bg-surface-canvas p-1 border border-surface-border shrink-0"
                    >
                      {trendTabs.map((tab) => {
                        const active = trendMetric === tab.metric;
                        return (
                          <button
                            key={tab.metric}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setTrendMetric(tab.metric)}
                            className={`min-h-[48px] sm:min-h-[40px] px-3.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli ${
                              active
                                ? "bg-surface text-ink-primary shadow-card border border-surface-border"
                                : "text-ink-muted hover:text-ink-primary border border-transparent"
                            }`}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {trend.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted num-tabular">
                      <span>
                        {t.dailyAverage}:{" "}
                        <strong className="text-ink-primary font-semibold">
                          <MoneyValue sen={dailyAvgSen} />
                        </strong>
                      </span>
                      {peakRow && (
                        <span>
                          {t.peakDay}:{" "}
                          <strong className="text-ink-primary font-semibold">
                            {peakRow.date.slice(5)} ·{" "}
                            <MoneyValue sen={trendValueSen(peakRow, trendMetric)} />
                          </strong>
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {trend.length === 0 ? (
                  <div className="py-12 text-center text-sm text-ink-muted">
                    {t.noDailyEntries}
                  </div>
                ) : (
                  <div key={trendMetric} className="flex-1 flex flex-col justify-between gap-4 animate-chart-swap">
                    {/* Interactive Inspector Bar with 48px Touch-Friendly Day Steppers */}
                    {inspectedRow && (
                      <div className="px-2 sm:px-3.5 py-1.5 rounded-xl bg-surface-subtle/60 border border-surface-border flex flex-wrap items-center justify-between gap-2 text-xs num-tabular">
                        <div className="flex items-center gap-1">
                          {trend.length > 1 && (
                            <button
                              type="button"
                              disabled={inspectedIdx <= 0}
                              onClick={() => setSelectedDate(trend[inspectedIdx - 1].date)}
                              aria-label={t.prevRecordedDay}
                              className="w-12 h-12 sm:w-10 sm:h-10 rounded-lg hover:bg-surface disabled:opacity-30 flex items-center justify-center text-ink-secondary cursor-pointer disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                              </svg>
                            </button>
                          )}
                          <span className="font-bold text-ink-primary">
                            {inspectedRow.date}
                          </span>
                          <span className="text-ink-muted">
                            {formatShortWeekday(inspectedRow.date, lang)}
                          </span>
                          {trend.length > 1 && (
                            <button
                              type="button"
                              disabled={inspectedIdx >= trend.length - 1}
                              onClick={() => setSelectedDate(trend[inspectedIdx + 1].date)}
                              aria-label={t.nextRecordedDay}
                              className="w-12 h-12 sm:w-10 sm:h-10 rounded-lg hover:bg-surface disabled:opacity-30 flex items-center justify-center text-ink-secondary cursor-pointer disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-3.5 px-1">
                          <span className="text-ink-muted">
                            {t.sheetRevCol}{" "}
                            <strong className="text-ink-primary font-semibold">
                              <MoneyValue sen={inspectedRow.totalSen} />
                            </strong>
                          </span>
                          <span className="text-ink-muted">
                            {t.sheetCostCol}{" "}
                            <strong className="text-ink-secondary font-semibold">
                              <MoneyValue sen={inspectedRow.costSen} />
                            </strong>
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Calendar-Proportional Bar Chart with Crisp HTML Axes (>= 11px real CSS pixels) */}
                    <div className="flex-1 flex gap-2.5 pt-2">
                      <div
                        aria-hidden="true"
                        className="flex flex-col justify-between items-end text-[11px] font-medium text-ink-muted num-tabular pb-6 shrink-0 select-none"
                      >
                        <span className="-mt-1.5">{formatCompactMyr(axisMaxSen)}</span>
                        <span>{formatCompactMyr(axisMidSen)}</span>
                        <span>RM 0</span>
                      </div>

                      <div className="flex-1 min-w-0 flex flex-col">
                        <div className="relative flex-1 min-h-[176px] lg:min-h-[228px] flex items-end gap-0.5 sm:gap-1 border-b border-surface-border">
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 flex flex-col justify-between"
                          >
                            <div className="border-t border-dashed border-surface-border w-full" />
                            <div className="border-t border-dashed border-surface-border w-full" />
                            <div className="w-full" />
                          </div>

                          {calendarSlots.map((slot) => {
                            const val = slot.row ? trendValueSen(slot.row, trendMetric) : 0;
                            // Truthful zero rendering: val === 0 renders flat 2px baseline marker, never a fake positive bar
                            const heightPct =
                              slot.row && val > 0
                                ? Math.max(2, Math.round((val / axisMaxSen) * 1000) / 10)
                                : 0;
                            const isSelected = inspectedRow?.date === slot.date;
                            const barColor =
                              trendMetric === "revenue"
                                ? "var(--chart-revenue)"
                                : "var(--chart-cost)";

                            return (
                              <div
                                key={slot.date}
                                className="relative z-10 flex-1 h-full flex flex-col justify-end items-center min-w-0"
                              >
                                {slot.row ? (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedDate(slot.date)}
                                    onMouseEnter={() => setSelectedDate(slot.date)}
                                    aria-label={`${slot.date}: ${formatDisplayMyr(val)}`}
                                    className="group w-full h-full flex items-end justify-center px-[1px] sm:px-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli rounded-t cursor-pointer"
                                  >
                                    {val > 0 ? (
                                      <span
                                        className={`w-full max-w-[30px] rounded-t-md sm:rounded-t-lg transition-opacity duration-150 ${
                                          isSelected ? "opacity-100" : "opacity-65 group-hover:opacity-90"
                                        }`}
                                        style={{
                                          height: `${heightPct}%`,
                                          backgroundColor: barColor,
                                        }}
                                      />
                                    ) : (
                                      <span
                                        className={`w-full max-w-[22px] h-[5px] rounded-full mb-[1px] ${
                                          isSelected
                                            ? "opacity-100 ring-2 ring-surface-border-strong"
                                            : "opacity-100"
                                        }`}
                                        style={{ backgroundColor: barColor }}
                                      />
                                    )}
                                  </button>
                                ) : (
                                  <span
                                    aria-hidden="true"
                                    className="w-1.5 h-1.5 rounded-full bg-ink-muted/70 mb-1"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Calendar Day Tick Labels: Prioritize recorded bars when sparse so Peak Day is always labeled */}
                        <div className="flex items-center gap-0.5 sm:gap-1 pt-2 h-6">
                          {calendarSlots.map((slot, idx) => {
                            const showTick = isSparseTrend
                              ? slot.row !== null
                              : idx === 0 ||
                                idx === calendarSlots.length - 1 ||
                                idx % Math.ceil(calendarSlots.length / 6) === 0;
                            const isSelected = inspectedRow?.date === slot.date;
                            return (
                              <span
                                key={`lbl-${slot.date}`}
                                className={`flex-1 text-center text-[11px] num-tabular leading-none ${
                                  isSelected
                                    ? "font-bold text-ink-primary"
                                    : "text-ink-muted"
                                }`}
                              >
                                {showTick ? slot.date.slice(8, 10) : ""}
                              </span>
                            );
                          })}
                        </div>

                        {/* Micro-key explaining recorded zero marker vs unrecorded gap dots when present */}
                        {(metricValues.some((v) => v === 0) || calendarSlots.some((s) => s.row === null)) && (
                          <div className="flex flex-wrap items-center justify-end gap-x-3.5 gap-y-1 pt-1.5 text-[11px] text-ink-muted">
                            {metricValues.some((v) => v === 0) && (
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  aria-hidden="true"
                                  className="inline-block w-3.5 h-[5px] rounded-full"
                                  style={{
                                    backgroundColor:
                                      trendMetric === "revenue"
                                        ? "var(--chart-revenue)"
                                        : "var(--chart-cost)",
                                  }}
                                />
                                <span>{t.chartKeyRecordedZero}</span>
                              </span>
                            )}
                            {calendarSlots.some((s) => s.row === null) && (
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  aria-hidden="true"
                                  className="inline-block w-1.5 h-1.5 rounded-full bg-ink-muted/70"
                                />
                                <span>{t.chartKeyUnrecorded}</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Right 5 Cols: Revenue Channel Split + Ranked Cost Categories (Zero Visual Duplication) */}
              <div className="lg:col-span-5 flex flex-col gap-5">
                {/* Payment Channel Split */}
                <section className="bg-surface border border-surface-border rounded-2xl p-5 sm:p-6 shadow-card space-y-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="text-base font-bold text-ink-primary">
                      {t.revenueSplit}
                    </h2>
                    {split && splitTotal > 0 && (
                      <span className="text-xs text-ink-muted num-tabular">
                        {cashPct}% / {tngPct}%
                      </span>
                    )}
                  </div>

                  {!split || splitTotal === 0 ? (
                    <div className="py-4 text-center text-sm text-ink-muted">
                      {t.noRevenueData}
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      <div className="w-full h-2.5 bg-surface-subtle rounded-full overflow-hidden flex gap-0.5">
                        {cashPct > 0 && (
                          <div
                            style={{ width: `${cashPct}%` }}
                            className="bg-channel-cash h-full transition-all duration-300"
                            title={`${t.cashRevenue}: ${cashPct}%`}
                          />
                        )}
                        {tngPct > 0 && (
                          <div
                            style={{ width: `${tngPct}%` }}
                            className="bg-channel-tng h-full transition-all duration-300"
                            title={`${t.tngRevenue}: ${tngPct}%`}
                          />
                        )}
                      </div>

                      <div className="divide-y divide-surface-border">
                        <div className="flex items-center justify-between py-2.5 gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-8 h-8 rounded-lg bg-channel-cash-light text-channel-cash flex items-center justify-center shrink-0">
                              <CashIcon className="w-4 h-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-ink-primary truncate">
                                {t.cashRevenue}
                              </div>
                              <div className="text-xs text-ink-muted num-tabular">
                                {cashPct}%
                              </div>
                            </div>
                          </div>
                          <MoneyValue
                            sen={BigInt(split.cashSen)}
                            className="text-sm font-bold text-ink-primary shrink-0"
                          />
                        </div>

                        <div className="flex items-center justify-between pt-2.5 gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-8 h-8 rounded-lg bg-channel-tng-light text-channel-tng flex items-center justify-center shrink-0">
                              <TngIcon className="w-4 h-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-ink-primary truncate">
                                {t.tngRevenue}
                              </div>
                              <div className="text-xs text-ink-muted num-tabular">
                                {tngPct}%
                              </div>
                            </div>
                          </div>
                          <MoneyValue
                            sen={BigInt(split.tngSen)}
                            className="text-sm font-bold text-ink-primary shrink-0"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                {/* Cost Categories: Single Ranked Horizontal Bar List (Zero Duplicated Strip) */}
                <section className="flex-1 bg-surface border border-surface-border rounded-2xl p-5 sm:p-6 shadow-card space-y-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <h2 className="text-base font-bold text-ink-primary">
                        {t.costDistribution}
                      </h2>
                      <p className="text-xs text-ink-muted mt-0.5">
                        {t.costDistributionSub}
                      </p>
                    </div>
                    {totalCostsSen > 0 && (
                      <MoneyValue
                        sen={totalCostsSen}
                        className="text-sm font-bold text-ink-secondary shrink-0"
                      />
                    )}
                  </div>

                  {rankedCosts.length === 0 ? (
                    <div className="py-5 text-center text-sm text-ink-muted">
                      {t.noCostData}
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      {rankedCosts.map((entry) => {
                        const token = COST_CATEGORY_TOKENS[entry.cat];
                        return (
                          <div key={entry.cat} className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2 text-sm">
                              <span className="flex items-center gap-2.5 min-w-0">
                                <span
                                  className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                                  style={{
                                    backgroundColor: token.softVar,
                                    color: token.colorVar,
                                  }}
                                >
                                  <CostCategoryIcon category={entry.cat} className="w-3.5 h-3.5" />
                                </span>
                                <span className="font-semibold text-ink-primary truncate">
                                  {categoryLabels[entry.cat]}
                                </span>
                              </span>
                              <span className="flex items-center gap-2 shrink-0 num-tabular">
                                <MoneyValue
                                  sen={entry.amountSen}
                                  className="font-semibold text-ink-primary text-sm"
                                />
                                <span className="text-xs font-semibold text-ink-muted w-9 text-right">
                                  {entry.pct}%
                                </span>
                              </span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-surface-subtle overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-300"
                                style={{
                                  width: `${Math.max(entry.pct, 2)}%`,
                                  backgroundColor: token.colorVar,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            </div>

            {/* 3. Daily Sheets Ledger (Order 1 on mobile right after Hero; Order 2 full-width on md+/desktop) */}
            <section className="order-1 md:order-2 bg-surface border border-surface-border rounded-2xl shadow-card overflow-hidden">
              <div className="px-5 py-4 sm:px-6 border-b border-surface-border flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-bold text-ink-primary">
                    {t.dailySheetsList}
                  </h2>
                  <span className="text-xs font-semibold text-ink-muted bg-surface-subtle px-2.5 py-0.5 rounded-full border border-surface-border num-tabular">
                    {trend.length} {t.daysUnit}
                  </span>
                </div>
              </div>

              {trend.length === 0 ? (
                <div className="p-8 text-center text-sm text-ink-muted">
                  {t.noDailyEntries}
                </div>
              ) : (
                <div>
                  {/* Desktop Table Column Headers */}
                  <div className="hidden sm:grid sm:grid-cols-12 px-6 py-2.5 text-xs font-semibold text-ink-muted bg-surface-subtle/50 border-b border-surface-border">
                    <span className="col-span-4">{t.dateCol}</span>
                    <span className="col-span-3 text-right">{t.sheetRevCol}</span>
                    <span className="col-span-2 text-right">{t.sheetCostCol}</span>
                    <span className="col-span-3 text-right">{t.sheetProfitCol}</span>
                  </div>

                  <div className="divide-y divide-surface-border">
                    {[...trend].reverse().map((row) => {
                      const grossSen = row.totalSen - row.costSen;
                      const weekday = formatShortWeekday(row.date, lang);
                      return (
                        <Link
                          key={row.date}
                          href={`/?date=${row.date}`}
                          className="group grid grid-cols-2 sm:grid-cols-12 items-center px-5 sm:px-6 py-3.5 hover:bg-surface-subtle/55 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-broccoli"
                        >
                          <div className="sm:col-span-4 flex items-center gap-2 min-w-0">
                            <span className="text-sm font-semibold text-ink-primary num-tabular group-hover:text-brand-broccoli transition-colors">
                              {row.date}
                            </span>
                            {weekday && (
                              <span className="text-xs text-ink-muted">
                                {weekday}
                              </span>
                            )}
                          </div>

                          {/* Desktop Columns */}
                          <div className="hidden sm:block sm:col-span-3 text-right text-sm font-semibold text-ink-primary">
                            <MoneyValue sen={row.totalSen} />
                          </div>
                          <div className="hidden sm:block sm:col-span-2 text-right text-sm font-medium text-ink-secondary">
                            <MoneyValue sen={row.costSen} />
                          </div>
                          <div className="hidden sm:flex sm:col-span-3 items-center justify-end gap-2">
                            <MoneyValue
                              sen={grossSen}
                              className={`text-sm font-bold ${
                                grossSen >= 0 ? "text-finance-profit" : "text-finance-loss"
                              }`}
                            />
                            <svg className="w-4 h-4 text-ink-muted group-hover:text-brand-broccoli group-hover:translate-x-0.5 transition-all shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </div>

                          {/* Mobile Compact Right Side */}
                          <div className="sm:hidden flex items-center justify-end gap-2">
                            <div className="text-right">
                              <div className="text-sm font-bold text-ink-primary">
                                <MoneyValue sen={row.totalSen} />
                              </div>
                              <div className="text-xs text-ink-muted">
                                {t.sheetProfitCol}{" "}
                                <MoneyValue
                                  sen={grossSen}
                                  className={`font-semibold ${
                                    grossSen >= 0 ? "text-finance-profit" : "text-finance-loss"
                                  }`}
                                />
                              </div>
                            </div>
                            <svg className="w-4 h-4 text-ink-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
