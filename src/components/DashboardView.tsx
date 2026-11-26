"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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

function formatSignedPercent(pct: number): string {
  return pct < 0 ? `\u2212${Math.abs(pct)}%` : `${pct}%`;
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

  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [rovingDateState, setRovingDateState] = useState<string | null>(null);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("revenue");
  const chartScrollRef = useRef<HTMLDivElement | null>(null);
  const chartPlotRef = useRef<HTMLDivElement | null>(null);
  const [plotViewportWidth, setPlotViewportWidth] = useState(0);
  const [plotScrollLeft, setPlotScrollLeft] = useState(0);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const suppressedHoverDateRef = useRef<string | null>(null);
  const pinnedByKeyboardRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setIsCoarsePointer(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const trendDateSet = useMemo(() => new Set(trend.map((r) => r.date)), [trend]);
  const validPinnedDate = pinnedDate && trendDateSet.has(pinnedDate) ? pinnedDate : null;
  const validFocusedDate = focusedDate && trendDateSet.has(focusedDate) ? focusedDate : null;
  const validHoveredDate = hoveredDate && trendDateSet.has(hoveredDate) ? hoveredDate : null;
  const activeDate = validPinnedDate ?? validFocusedDate ?? validHoveredDate;

  useEffect(() => {
    const el = chartScrollRef.current;
    if (!el) return;
    const measure = () => {
      setPlotViewportWidth(el.clientWidth);
      setPlotScrollLeft(el.scrollLeft);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [activeMonth, trendMetric, trend.length]);

  useEffect(() => {
    if (!validPinnedDate) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (chartPlotRef.current && !chartPlotRef.current.contains(event.target as Node)) {
        pinnedByKeyboardRef.current = false;
        setPinnedDate(null);
        setFocusedDate(null);
        setHoveredDate(null);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [validPinnedDate]);

  useEffect(() => {
    if (!activeDate) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        pinnedByKeyboardRef.current = false;
        setPinnedDate(null);
        setFocusedDate(null);
        setHoveredDate(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeDate]);

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

  const activeRow = useMemo(() => {
    if (!activeDate) return null;
    return trend.find((r) => r.date === activeDate) ?? null;
  }, [trend, activeDate]);
  const activeSlotIdx = useMemo(() => {
    if (!activeRow) return -1;
    return calendarSlots.findIndex((s) => s.date === activeRow.date);
  }, [calendarSlots, activeRow]);
  const rovingDate =
    rovingDateState && trendDateSet.has(rovingDateState)
      ? rovingDateState
      : trend.length > 0
        ? trend[trend.length - 1].date
        : null;
  // Scroll on touch devices (phones & tablets at any width) and narrow viewports whenever adjacent selectable days sit < 24px apart (WCAG Target Size) or slots < 10px; sparse short ranges fit without hiding early days
  const minRecordedSlotGap = useMemo(() => {
    let minGap = Infinity;
    let prevIdx = -1;
    for (let i = 0; i < calendarSlots.length; i++) {
      if (calendarSlots[i].row !== null) {
        if (prevIdx >= 0) minGap = Math.min(minGap, i - prevIdx);
        prevIdx = i;
      }
    }
    return minGap;
  }, [calendarSlots]);
  const slotWidthIfFit =
    plotViewportWidth > 0 && calendarSlots.length > 0
      ? plotViewportWidth / calendarSlots.length
      : 0;
  const closestSelectableGapPx =
    minRecordedSlotGap === Infinity ? plotViewportWidth : minRecordedSlotGap * slotWidthIfFit;
  const enforceTouchSpacing = isCoarsePointer || plotViewportWidth < 400;
  const needsPlotScroll =
    plotViewportWidth > 0 &&
    calendarSlots.length > 0 &&
    (enforceTouchSpacing
      ? closestSelectableGapPx < 24 || slotWidthIfFit < 10
      : slotWidthIfFit < 14);
  const trackPadPx = needsPlotScroll ? 4 : 0;
  const plotTrackWidth = needsPlotScroll
    ? calendarSlots.length * 24 + trackPadPx * 2
    : plotViewportWidth;
  const canScrollPlotLeft = needsPlotScroll && plotScrollLeft > 4;
  const canScrollPlotRight =
    needsPlotScroll &&
    plotViewportWidth > 0 &&
    plotScrollLeft + plotViewportWidth < plotTrackWidth - 4;

  const scrollChartBy = (direction: -1 | 1) => {
    const el = chartScrollRef.current;
    if (!el) return;
    const step = Math.max(120, Math.round((plotViewportWidth || 240) * 0.75));
    const nextLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + direction * step));
    el.scrollTo({ left: nextLeft, behavior: "smooth" });
  };

  // Start scrolled at the latest recorded days when horizontal scroll is active
  useEffect(() => {
    const el = chartScrollRef.current;
    if (!el || !needsPlotScroll) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollLeft = maxScroll;
    setPlotScrollLeft(maxScroll);
  }, [activeMonth, trendMetric, needsPlotScroll, calendarSlots.length]);

  const trendTabs: Array<{ metric: TrendMetric; label: string }> = [
    { metric: "revenue", label: t.dailyTrend },
    { metric: "cost", label: t.dailyCostTrend },
  ];
  const trendTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

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
            className="inline-flex items-center gap-1.5 min-h-[48px] h-12 lg:min-h-[44px] lg:h-11 px-3 sm:px-4 rounded-xl bg-brand-cta hover:bg-brand-cta-hover text-brand-cta-ink text-sm font-semibold btn-tactile shadow-card whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli"
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
              aria-label={t.monthSummary}
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
                        {t.profitMargin} {formatSignedPercent(netMarginPct)}
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
                    <span
                      className={`font-semibold num-tabular whitespace-nowrap ${
                        activeTile.dailyCostSen > 0 ? "text-finance-loss" : "text-ink-secondary"
                      }`}
                    >
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
                      className={`font-bold ${
                        activeTile.grossSen < 0 ? "text-finance-loss" : "text-ink-primary"
                      }`}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-ink-muted">
                      <span className="w-2 h-2 rounded-full bg-finance-opex shrink-0" aria-hidden="true" />
                      <span>{t.operatingExpenses}</span>
                    </span>
                    <span
                      className={`font-semibold num-tabular whitespace-nowrap ${
                        activeTile.operatingSen > 0 ? "text-finance-loss" : "text-ink-secondary"
                      }`}
                    >
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

          {/* Consistent DOM & visual order across all viewports (matches DashboardSkeleton and linear keyboard focus) */}
          <div className="flex flex-col gap-5">
            {/* 2. Analytics Bento Row */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              {/* Left 7 Cols: Calendar-Proportional Daily Bar Chart with Chrome-Style Browser Tabs */}
              <section className="lg:col-span-7 bg-surface border border-surface-border rounded-2xl shadow-card flex flex-col">
                <h2 className="sr-only">
                  {trendMetric === "revenue" ? t.dailyTrend : t.dailyCostTrend}
                </h2>

                {/* Chrome-style Browser Tab Strip */}
                <div
                  role="tablist"
                  aria-label={t.chartMetricTabsLabel}
                  className="bg-surface-subtle dark:bg-surface-canvas border-b border-surface-border rounded-t-2xl px-3 pt-2 flex items-end gap-1"
                >
                  {trendTabs.map((tab, idx) => {
                    const active = trendMetric === tab.metric;
                    const isRevTab = tab.metric === "revenue";
                    return (
                      <button
                        key={tab.metric}
                        ref={(el) => {
                          trendTabRefs.current[idx] = el;
                        }}
                        id={`daily-trend-tab-${tab.metric}`}
                        role="tab"
                        type="button"
                        aria-selected={active}
                        aria-controls="daily-trend-panel"
                        tabIndex={active ? 0 : -1}
                        onClick={() => setTrendMetric(tab.metric)}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                            e.preventDefault();
                            const nextIdx = (idx + 1) % trendTabs.length;
                            setTrendMetric(trendTabs[nextIdx].metric);
                            trendTabRefs.current[nextIdx]?.focus();
                          }
                        }}
                        className={`relative min-h-[48px] lg:min-h-[42px] px-3 sm:px-4 rounded-t-xl text-[13px] sm:text-sm transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 sm:gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-broccoli ${
                          active
                            ? "z-10 -mb-px bg-surface text-ink-primary font-bold border border-surface-border border-b-surface"
                            : "mb-1 rounded-xl text-ink-muted hover:text-ink-primary hover:bg-surface/65 font-medium border border-transparent"
                        }`}
                      >
                        {active && (
                          <>
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 10 10"
                              className="absolute bottom-0 -left-[9px] w-[10px] h-[10px] pointer-events-none"
                            >
                              <path d="M 10 0 L 10 10 L 0 10 A 9.5 9.5 0 0 0 9.5 0 Z" fill="rgb(var(--surface-default))" />
                              <path d="M 0 9.5 A 9.5 9.5 0 0 0 9.5 0" fill="none" stroke="rgb(var(--surface-border))" strokeWidth="1" />
                            </svg>
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 10 10"
                              className="absolute bottom-0 -right-[9px] w-[10px] h-[10px] pointer-events-none"
                            >
                              <path d="M 0 0 L 0 10 L 10 10 A 9.5 9.5 0 0 1 0.5 0 Z" fill="rgb(var(--surface-default))" />
                              <path d="M 10 9.5 A 9.5 9.5 0 0 1 0.5 0" fill="none" stroke="rgb(var(--surface-border))" strokeWidth="1" />
                            </svg>
                          </>
                        )}
                        <span
                          aria-hidden="true"
                          className={`w-2 h-2 rounded-full shrink-0 transition-opacity ${
                            isRevTab ? "bg-finance-profit" : "bg-finance-cost"
                          } ${active ? "opacity-100" : "opacity-55"}`}
                        />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Tab Panel Body */}
                <div
                  id="daily-trend-panel"
                  role="tabpanel"
                  aria-labelledby={`daily-trend-tab-${trendMetric}`}
                  className="p-5 sm:p-6 flex-1 flex flex-col gap-3"
                >
                {trend.length === 0 ? (
                  <div className="py-10 text-center text-sm text-ink-muted">
                    {t.noDailyEntries}
                  </div>
                ) : (
                  <div key={trendMetric} className="pt-[52px] sm:pt-12 flex-1 flex flex-col justify-between gap-3 animate-chart-swap">
                    {/* Screen-reader live readout only when a bar is explicitly pinned or keyboard-focused (never noisy passive hover) */}
                    <div className="sr-only" aria-live="polite" aria-atomic="true">
                      {(validPinnedDate ?? validFocusedDate) && activeRow
                        ? `${activeRow.date} ${formatShortWeekday(activeRow.date, lang)} ${t.sheetRevCol} ${formatDisplayMyr(activeRow.totalSen)} ${t.sheetCostCol} ${formatDisplayMyr(activeRow.costSen)}`
                        : ""}
                    </div>

                    {/* Calendar-Proportional Bar Chart with On-Demand Floating Popout in clean headspace above bars (never covers tabs, bars, or summary figures) */}
                    <div className="flex-1 grid grid-cols-[auto_1fr] gap-x-2.5">
                      <div
                        aria-hidden="true"
                        className="h-[188px] lg:h-[244px] flex flex-col justify-between items-end text-[11px] font-medium text-ink-muted num-tabular leading-none shrink-0 select-none"
                      >
                        <span className="-mt-1">{formatCompactMyr(axisMaxSen)}</span>
                        <span>{formatCompactMyr(axisMidSen)}</span>
                        <span className="-mb-1">RM 0</span>
                      </div>

                      <div
                        className="relative min-w-0"
                        onPointerLeave={(e) => {
                          if (e.pointerType === "mouse") {
                            setHoveredDate(null);
                            suppressedHoverDateRef.current = null;
                          }
                        }}
                      >
                        {/* On-Demand Floating Day Popout positioned strictly ABOVE the bar plot so it never covers or blocks any bar or summary figure */}
                        {activeRow && activeSlotIdx >= 0 && (() => {
                          const effectiveViewportW = plotViewportWidth > 0 ? plotViewportWidth : 280;
                          const effectiveInnerW = needsPlotScroll
                            ? plotTrackWidth - trackPadPx * 2
                            : effectiveViewportW;
                          const slotWidth = effectiveInnerW / calendarSlots.length;
                          const barLeftPx = trackPadPx + activeSlotIdx * slotWidth;
                          const barRightPx = trackPadPx + (activeSlotIdx + 1) * slotWidth;
                          const barCenterPx = trackPadPx + (activeSlotIdx + 0.5) * slotWidth;
                          const scrollOffset = needsPlotScroll ? plotScrollLeft : 0;

                          // Hide popout cleanly when its bar scrolls completely out of the visible scroll window
                          if (
                            needsPlotScroll &&
                            (barRightPx < scrollOffset + 2 ||
                              barLeftPx > scrollOffset + effectiveViewportW - 2)
                          ) {
                            return null;
                          }

                          const popW = Math.min(effectiveViewportW, effectiveViewportW < 320 ? 156 : 168);
                          const visibleCenter = barCenterPx - scrollOffset;
                          const maxLeft = Math.max(0, effectiveViewportW - popW);
                          const popLeft = Math.round(Math.max(0, Math.min(maxLeft, visibleCenter - popW / 2)));
                          const caretLeft = Math.round(
                            Math.max(12, Math.min(popW - 12, visibleCenter - popLeft))
                          );
                          const activeVal = trendValueSen(activeRow, trendMetric);

                          return (
                            <div
                              data-testid="chart-day-popover"
                              aria-hidden="true"
                              style={{ left: `${popLeft}px`, width: `${popW}px`, bottom: "calc(100% + 4px)" }}
                              onPointerEnter={(e) => {
                                if (e.pointerType === "mouse") {
                                  setHoveredDate(activeRow.date);
                                }
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                pinnedByKeyboardRef.current = false;
                                setPinnedDate(null);
                                setFocusedDate(null);
                                setHoveredDate(null);
                              }}
                              className="pointer-events-auto absolute z-30 rounded-xl bg-surface border border-surface-border-strong/60 shadow-popover px-2.5 py-1 text-left transition-opacity duration-150 cursor-pointer"
                            >
                              {/* Exact 4px vertical hover seam ending at the plot top boundary (never extends into bar hit targets) */}
                              <span
                                aria-hidden="true"
                                className="absolute -bottom-1 inset-x-0 h-1"
                              />
                              {/* Downward caret pointing directly to the inspected bar */}
                              <span
                                aria-hidden="true"
                                style={{ left: `${caretLeft}px` }}
                                className="pointer-events-none absolute -bottom-[5px] -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-surface border-r border-b border-surface-border-strong/60"
                              />
                              <div className="flex items-center justify-between gap-1.5 text-[11px] font-semibold text-ink-muted leading-tight whitespace-nowrap">
                                <span className="num-tabular text-ink-secondary">{activeRow.date}</span>
                                <span>{formatShortWeekday(activeRow.date, lang)}</span>
                              </div>
                              <div
                                className={`text-sm font-bold num-tabular leading-snug whitespace-nowrap ${
                                  trendMetric === "revenue" ? "text-ink-primary" : "text-finance-cost"
                                }`}
                              >
                                <MoneyValue sen={activeVal} />
                              </div>
                              <div className="flex items-baseline justify-between gap-1.5 text-[11px] text-ink-muted num-tabular leading-tight whitespace-nowrap">
                                <span className="truncate">{trendMetric === "revenue" ? t.sheetCostCol : t.sheetRevCol}</span>
                                <strong className="font-semibold text-ink-secondary shrink-0">
                                  <MoneyValue
                                    sen={trendMetric === "revenue" ? activeRow.costSen : activeRow.totalSen}
                                  />
                                </strong>
                              </div>
                            </div>
                          );
                        })()}

                        {canScrollPlotLeft && (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-y-0 left-0 w-7 z-20 bg-gradient-to-r from-surface via-surface/75 to-transparent"
                          />
                        )}
                        {canScrollPlotRight && (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-y-0 right-0 w-7 z-20 bg-gradient-to-l from-surface via-surface/75 to-transparent"
                          />
                        )}
                        <div
                          ref={chartScrollRef}
                          onScroll={(e) => setPlotScrollLeft(e.currentTarget.scrollLeft)}
                          className={`min-w-0 ${needsPlotScroll ? "overflow-x-auto pb-1 -mb-1" : ""}`}
                        >
                          <div
                            className={needsPlotScroll ? "px-1" : undefined}
                            style={
                              needsPlotScroll
                                ? { minWidth: `${plotTrackWidth}px` }
                                : undefined
                            }
                          >
                            <div
                              ref={chartPlotRef}
                              onBlur={(e) => {
                                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                                  pinnedByKeyboardRef.current = false;
                                  setFocusedDate(null);
                                  setPinnedDate(null);
                                }
                              }}
                              onClick={(e) => {
                                if (e.target === e.currentTarget) {
                                  pinnedByKeyboardRef.current = false;
                                  setPinnedDate(null);
                                  setFocusedDate(null);
                                  setHoveredDate(null);
                                }
                              }}
                              className="relative min-w-0 h-[188px] lg:h-[244px] flex items-end gap-0.5 sm:gap-1 border-b border-surface-border"
                            >
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
                                // Truthful zero rendering: val === 0 renders flat baseline pill, never a fake positive bar
                                const heightPct =
                                  slot.row && val > 0
                                    ? Math.max(2, Math.round((val / axisMaxSen) * 1000) / 10)
                                    : 0;
                                const isSelected = activeRow?.date === slot.date;
                                const hasAnySelection = activeRow !== null;
                                const barColor =
                                  trendMetric === "revenue"
                                    ? "var(--chart-revenue)"
                                    : "var(--chart-cost)";

                                return (
                                  <div
                                    key={slot.date}
                                    onPointerEnter={
                                      slot.row === null
                                        ? (e) => {
                                            if (e.pointerType === "mouse") {
                                              setHoveredDate(null);
                                              suppressedHoverDateRef.current = null;
                                            }
                                          }
                                        : undefined
                                    }
                                    className="relative z-10 flex-1 h-full flex flex-col justify-end items-center min-w-0"
                                  >
                                    {slot.row ? (
                                      <button
                                        type="button"
                                        data-chart-day={slot.date}
                                        tabIndex={slot.date === rovingDate ? 0 : -1}
                                        aria-pressed={validPinnedDate === slot.date}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setRovingDateState(slot.date);
                                          if (validPinnedDate === slot.date) {
                                            pinnedByKeyboardRef.current = false;
                                            setPinnedDate(null);
                                            setFocusedDate(null);
                                            setHoveredDate(null);
                                            suppressedHoverDateRef.current = slot.date;
                                          } else {
                                            pinnedByKeyboardRef.current = e.detail === 0;
                                            suppressedHoverDateRef.current = null;
                                            setPinnedDate(slot.date);
                                          }
                                        }}
                                        onPointerEnter={(e) => {
                                          if (
                                            e.pointerType === "mouse" &&
                                            suppressedHoverDateRef.current !== slot.date
                                          ) {
                                            setHoveredDate(slot.date);
                                          }
                                        }}
                                        onPointerLeave={(e) => {
                                          if (
                                            e.pointerType === "mouse" &&
                                            suppressedHoverDateRef.current === slot.date
                                          ) {
                                            suppressedHoverDateRef.current = null;
                                          }
                                        }}
                                        onFocus={(e) => {
                                          setRovingDateState(slot.date);
                                          if (e.currentTarget.matches(":focus-visible")) {
                                            setFocusedDate(slot.date);
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === "Escape") {
                                            e.preventDefault();
                                            pinnedByKeyboardRef.current = false;
                                            setPinnedDate(null);
                                            setFocusedDate(null);
                                            setHoveredDate(null);
                                            return;
                                          }
                                          const currentIdx = trend.findIndex((r) => r.date === slot.date);
                                          if (currentIdx === -1) return;
                                          let nextIdx = -1;
                                          if (e.key === "ArrowLeft") nextIdx = Math.max(0, currentIdx - 1);
                                          else if (e.key === "ArrowRight") nextIdx = Math.min(trend.length - 1, currentIdx + 1);
                                          else if (e.key === "Home") nextIdx = 0;
                                          else if (e.key === "End") nextIdx = trend.length - 1;
                                          if (nextIdx === -1 || nextIdx === currentIdx) return;
                                          e.preventDefault();
                                          const nextDate = trend[nextIdx].date;
                                          pinnedByKeyboardRef.current = false;
                                          setRovingDateState(nextDate);
                                          setFocusedDate(nextDate);
                                          setPinnedDate(null);
                                          requestAnimationFrame(() => {
                                            const nextBtn = document.querySelector<HTMLButtonElement>(
                                              `button[data-chart-day="${nextDate}"]`
                                            );
                                            nextBtn?.focus();
                                            nextBtn?.scrollIntoView({ block: "nearest", inline: "nearest" });
                                          });
                                        }}
                                        aria-label={`${slot.date}: ${formatDisplayMyr(val)}`}
                                        aria-describedby="chart-kbd-hint"
                                        className="group w-full h-full flex items-end justify-center px-[1px] sm:px-0.5 focus:outline-none rounded-t cursor-pointer"
                                      >
                                        {val > 0 ? (
                                          <span
                                            className={`w-full max-w-[30px] rounded-t-md sm:rounded-t-lg transition-all duration-150 group-focus-visible:opacity-100 group-focus-visible:ring-2 group-focus-visible:ring-brand-broccoli group-focus-visible:ring-offset-1 group-focus-visible:ring-offset-surface ${
                                              isSelected
                                                ? focusedDate === slot.date
                                                  ? "opacity-100 shadow-sm"
                                                  : "opacity-100 ring-2 ring-ink-primary/85 dark:ring-ink-primary/90 ring-offset-1 ring-offset-surface shadow-sm"
                                                : hasAnySelection
                                                  ? "opacity-80 group-hover:opacity-100"
                                                  : "opacity-90 group-hover:opacity-100"
                                            }`}
                                            style={{
                                              height: `${heightPct}%`,
                                              backgroundColor: barColor,
                                            }}
                                          />
                                        ) : (
                                          <span
                                            className={`w-full max-w-[22px] h-[6px] rounded-full mb-[1px] border-[1.5px] bg-surface transition-all duration-150 group-focus-visible:ring-2 group-focus-visible:ring-brand-broccoli group-focus-visible:ring-offset-1 group-focus-visible:ring-offset-surface ${
                                              isSelected && focusedDate !== slot.date
                                                ? "opacity-100 ring-2 ring-ink-primary/85 dark:ring-ink-primary/90 ring-offset-1 ring-offset-surface"
                                                : "opacity-100"
                                            }`}
                                            style={{ borderColor: barColor }}
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

                            {/* Calendar Day Tick Labels: Always include start & end bounds, skipping adjacent ticks within 2 slots of end */}
                            <div className="flex items-center gap-0.5 sm:gap-1 pt-2 h-6 min-w-0">
                              {calendarSlots.map((slot, idx) => {
                                const lastIdx = calendarSlots.length - 1;
                                const step = needsPlotScroll
                                  ? 3
                                  : Math.max(1, Math.ceil(calendarSlots.length / 6));
                                const showTick = isSparseTrend
                                  ? slot.row !== null || idx === 0 || idx === lastIdx
                                  : idx === 0 ||
                                    idx === lastIdx ||
                                    (idx <= lastIdx - 3 && idx % step === 0);
                                const isSelected = activeRow?.date === slot.date;
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
                          </div>
                        </div>
                      </div>

                      {/* Persistent horizontal scroll controls when dense months scroll on phones/touch tablets (44px touch targets, rounded-xl button shape, aria-disabled keeps focus ring at boundaries) */}
                      {needsPlotScroll && (
                        <div className="col-start-2 flex items-center justify-between gap-2 pt-1">
                          <button
                            type="button"
                            aria-disabled={!canScrollPlotLeft}
                            onClick={() => {
                              if (canScrollPlotLeft) scrollChartBy(-1);
                            }}
                            className={`group inline-flex items-center min-h-[44px] -my-1 focus:outline-none ${
                              canScrollPlotLeft ? "cursor-pointer" : "opacity-35 cursor-not-allowed"
                            }`}
                          >
                            <span
                              className={`inline-flex items-center gap-1 h-9 px-3 rounded-xl bg-surface-subtle group-focus-visible:ring-2 group-focus-visible:ring-brand-broccoli border border-surface-border shadow-control text-xs font-semibold text-ink-secondary transition-colors ${
                                canScrollPlotLeft ? "group-hover:bg-surface-hover" : ""
                              }`}
                            >
                              <span aria-hidden="true">←</span>
                              <span>{t.chartEarlierDays}</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-disabled={!canScrollPlotRight}
                            onClick={() => {
                              if (canScrollPlotRight) scrollChartBy(1);
                            }}
                            className={`group inline-flex items-center min-h-[44px] -my-1 focus:outline-none ${
                              canScrollPlotRight ? "cursor-pointer" : "opacity-35 cursor-not-allowed"
                            }`}
                          >
                            <span
                              className={`inline-flex items-center gap-1 h-9 px-3 rounded-xl bg-surface-subtle group-focus-visible:ring-2 group-focus-visible:ring-brand-broccoli border border-surface-border shadow-control text-xs font-semibold text-ink-secondary transition-colors ${
                                canScrollPlotRight ? "group-hover:bg-surface-hover" : ""
                              }`}
                            >
                              <span>{t.chartLaterDays}</span>
                              <span aria-hidden="true">→</span>
                            </span>
                          </button>
                        </div>
                      )}

                      {/* Discoverable keyboard hint (always available to SR via aria-describedby, visible when keyboard-focusing chart bars) */}
                      <p
                        id="chart-kbd-hint"
                        className={
                          focusedDate !== null
                            ? "col-start-2 pt-1.5 text-[11px] text-ink-muted text-right"
                            : "sr-only"
                        }
                      >
                        {t.chartKeyboardHint}
                      </p>

                      {/* Micro-key explaining recorded zero marker vs unrecorded gap dots when present */}
                      {(metricValues.some((v) => v === 0) || calendarSlots.some((s) => s.row === null)) && (
                        <div className="col-start-2 flex flex-wrap items-center justify-end gap-x-3.5 gap-y-1 pt-1.5 text-[11px] text-ink-muted">
                          {metricValues.some((v) => v === 0) && (
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                aria-hidden="true"
                                className="inline-block w-3.5 h-[6px] rounded-full border-[1.5px] bg-surface"
                                style={{
                                  borderColor:
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

                    {/* Reference Summary Footer (Logged-day avg & Peak day stay 100% readable below the plot while inspecting any bar) */}
                    <div className="pt-2.5 border-t border-surface-border/70 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-ink-muted num-tabular">
                      <span>
                        {t.dailyAverage}{lang === "zh" ? "：" : ": "}
                        <strong className="text-ink-primary font-semibold">
                          <MoneyValue sen={dailyAvgSen} />
                        </strong>
                      </span>
                      {peakRow && (
                        <span>
                          {t.peakDay}{lang === "zh" ? "：" : ": "}
                          <strong className="text-ink-primary font-semibold">
                            {peakRow.date.slice(5)} ·{" "}
                            <MoneyValue sen={trendValueSen(peakRow, trendMetric)} />
                          </strong>
                        </span>
                      )}
                    </div>
                  </div>
                )}
                </div>
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

            {/* 3. Daily Sheets Ledger */}
            <section className="bg-surface border border-surface-border rounded-2xl shadow-card overflow-hidden">
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
                            <span className="sr-only">{t.sheetRevCol}: </span>
                            <MoneyValue sen={row.totalSen} />
                          </div>
                          <div className="hidden sm:block sm:col-span-2 text-right text-sm font-medium text-ink-secondary">
                            <span className="sr-only">{t.sheetCostCol}: </span>
                            <MoneyValue sen={row.costSen} />
                          </div>
                          <div className="hidden sm:flex sm:col-span-3 items-center justify-end gap-2">
                            <span className="sr-only">{t.sheetProfitCol}: </span>
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
                                <span className="sr-only">{t.sheetRevCol}: </span>
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
