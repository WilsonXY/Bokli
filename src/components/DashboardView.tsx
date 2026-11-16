"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { amountSizeClass, formatMyr } from "@/lib/money";
import type { MonthStatus } from "@/services/dashboard";
import { MonthSelectorDropdown } from "@/components/MonthSelectorDropdown";

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

/** Line colours per trend metric: revenue in TnG blue, Daily Cost in finance-cost amber. */
const TREND_METRIC_COLORS: Record<
  TrendMetric,
  { line: string; active: string; halo: string }
> = {
  revenue: { line: "#2563eb", active: "#1d4ed8", halo: "#bfdbfe" },
  cost: { line: "#d97706", active: "#b45309", halo: "#fde68a" },
};

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

export function getDonutSlice(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  rawStartPct: number,
  rawEndPct: number
) {
  const startPct = Math.round(rawStartPct * 10000) / 10000;
  const endPct = Math.round(rawEndPct * 10000) / 10000;
  const sliceDelta = Math.round((endPct - startPct) * 10000) / 10000;
  const largeArc = sliceDelta > 0.5 ? 1 : 0;

  const startAngle = (startPct * 360 - 90) * (Math.PI / 180);
  const endAngle = (endPct * 360 - 90) * (Math.PI / 180);

  const x1Outer = (cx + rOuter * Math.cos(startAngle)).toFixed(4);
  const y1Outer = (cy + rOuter * Math.sin(startAngle)).toFixed(4);
  const x2Outer = (cx + rOuter * Math.cos(endAngle)).toFixed(4);
  const y2Outer = (cy + rOuter * Math.sin(endAngle)).toFixed(4);

  const x1Inner = (cx + rInner * Math.cos(endAngle)).toFixed(4);
  const y1Inner = (cy + rInner * Math.sin(endAngle)).toFixed(4);
  const x2Inner = (cx + rInner * Math.cos(startAngle)).toFixed(4);
  const y2Inner = (cy + rInner * Math.sin(startAngle)).toFixed(4);

  // A single-category month yields one slice spanning the whole circle. Its two
  // arc endpoints coincide, and SVG drops an elliptical arc whose endpoints are
  // identical — the donut would render empty. Emit a closed ring instead: two
  // half arcs for the outer edge, two counter-wound half arcs to punch the hole.
  const xMid = cx.toFixed(4);
  const yTopOuter = (cy - rOuter).toFixed(4);
  const yBotOuter = (cy + rOuter).toFixed(4);
  const yTopInner = (cy - rInner).toFixed(4);
  const yBotInner = (cy + rInner).toFixed(4);

  const d =
    sliceDelta >= 1
      ? `M ${xMid} ${yTopOuter} A ${rOuter} ${rOuter} 0 1 1 ${xMid} ${yBotOuter} A ${rOuter} ${rOuter} 0 1 1 ${xMid} ${yTopOuter} Z M ${xMid} ${yTopInner} A ${rInner} ${rInner} 0 1 0 ${xMid} ${yBotInner} A ${rInner} ${rInner} 0 1 0 ${xMid} ${yTopInner} Z`
      : `M ${x1Outer} ${y1Outer} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2Outer} ${y2Outer} L ${x1Inner} ${y1Inner} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x2Inner} ${y2Inner} Z`;

  // Mid-angle for embedding percentage label directly into donut slice
  const midAngle = (((startPct + endPct) / 2) * 360 - 90) * (Math.PI / 180);
  const rMid = (rOuter + rInner) / 2;
  const tx = Number((cx + rMid * Math.cos(midAngle)).toFixed(4));
  const ty = Number((cy + rMid * Math.sin(midAngle)).toFixed(4));

  return { d, tx, ty };
}

/**
 * Turns cost entries into donut slice boundaries. Boundaries come from the exact
 * sen shares (integer amounts), never from the rounded display percentages — the
 * rounded ones leave visible gaps (three equal slices stop at 0.99). The last
 * slice is pinned to 1 so the ring always closes.
 */
export function buildCostSlices<T extends { amountSen: number }>(
  entries: T[]
): Array<T & { start: number; end: number }> {
  // Zero-amount entries would render as degenerate zero-width slices, so the
  // helper filters them itself — callers shouldn't have to remember to.
  const positive = entries.filter((e) => e.amountSen > 0);
  const totalSen = positive.reduce((acc, entry) => acc + entry.amountSen, 0);
  if (totalSen <= 0) return [];

  let runningSen = 0;
  return positive.map((entry, idx) => {
    const start = runningSen / totalSen;
    runningSen += entry.amountSen;
    const end = idx === positive.length - 1 ? 1 : runningSen / totalSen;
    return { ...entry, start, end };
  });
}

/** Pick readable label ink against the chart colour, independently of theme. */
export function chartLabelInk(hex: string): string {
  const rgb = hex.slice(1).match(/../g)!.map(part => parseInt(part, 16) / 255);
  const linear = rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  // White needs 4.5:1. The dark ink covers the brighter category colours.
  return 1.05 / (luminance + 0.05) >= 4.5 ? "#ffffff" : "#000000";
}

export function DashboardView({ tiles, activeMonth, activeTile, trend, split, costByCategory, loadError }: DashboardViewProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("revenue");
  const labels: Record<keyof SerializedCostByCategory, string> = {
    restock: t.catRestock, gas: t.catGas, transport: t.catTransport,
    "wages-daily": t.catWagesDaily, maintenance: t.catMaintenance, other: t.catOther,
  };
  const palette: Record<keyof SerializedCostByCategory, string> = {
    restock: "#2563eb", gas: "#f59e0b", transport: "#c26032",
    "wages-daily": "#f43f5e", maintenance: "#0d9488", other: "#64748b",
  };
  const totalCosts = costByCategory ? Object.values(costByCategory).reduce((sum, value) => sum + value, 0) : 0;
  const costs = (Object.keys(labels) as Array<keyof SerializedCostByCategory>)
    .map(cat => ({ cat, label: labels[cat], amountSen: costByCategory?.[cat] ?? 0, hex: palette[cat], pct: totalCosts > 0 ? Math.round((costByCategory![cat] / totalCosts) * 100) : 0 }))
    .filter(item => item.amountSen > 0);
  const slices = buildCostSlices(costs);
  const headline = activeTile ? formatMyr(BigInt(activeTile.netSen)) : formatMyr(0n);
  const isProfitPositive = !activeTile || BigInt(activeTile.netSen) >= 0n;
  const metrics = [
    { label: t.totalRevenue, value: activeTile?.revenueSen ?? 0, ink: "text-ink-primary" },
    { label: t.costsTitle, value: activeTile?.dailyCostSen ?? 0, ink: "text-ink-secondary" },
    { label: t.operatingExpenses, value: activeTile?.operatingSen ?? 0, ink: "text-ink-secondary" },
  ];
  const cashPct = split?.totalSen ? Math.round(split.cashSen / split.totalSen * 100) : 0;
  const tngPct = split?.totalSen ? 100 - cashPct : 0;
  const metricLabel = trendMetric === "revenue" ? t.sheetRevCol : t.sheetCostCol;
  const chartW = 600, chartH = 180, padX = 14, padY = 18;
  const maximum = Math.max(1000, ...trend.map(row => trendValueSen(row, trendMetric)));
  const points = trend.map((row, index) => ({
    x: trend.length === 1 ? chartW / 2 : padX + index / (trend.length - 1) * (chartW - padX * 2),
    y: chartH - padY - trendValueSen(row, trendMetric) / maximum * (chartH - padY * 2),
  }));
  const line = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = points.length ? `${line} L ${points[points.length - 1].x} ${chartH - padY} L ${points[0].x} ${chartH - padY} Z` : "";
  const chartColor = TREND_METRIC_COLORS[trendMetric].line;
  return (
    <div className="dashboard-layout page-stack">
      <div className="page-heading">
        <div><h1>{t.overviewTitle}</h1><p className="page-description">{t.overviewHint}</p></div>
        <MonthSelectorDropdown currentMonth={activeMonth} options={tiles.map(tile => ({ month: tile.month, status: tile.status }))} onSelect={month => router.push(`/dashboard?month=${month}`)} />
      </div>
      {loadError ? <div role="alert" className="page-error">{t.loadError}<p>{loadError}</p></div> : <>
        <section className="overview-summary panel" aria-label={t.monthSummary}>
          <div className={`profit-headline${isProfitPositive ? "" : " is-loss"}`}>
            <h2>{t.netProfit}</h2>
            <span data-long={headline.length > 11 || undefined} className={`metric-headline ${amountSizeClass(headline, "text-2xl", "text-3xl")} sm:text-4xl font-extrabold tracking-tight tabular-nums ${isProfitPositive ? "text-finance-profit" : "text-finance-loss"}`}>{headline}</span>
            <p>{t.netProfitFormula}</p>
          </div>
          <div className="summary-metrics">{metrics.map(metric => {
            const amount = formatMyr(BigInt(metric.value));
            return <div className="summary-metric" key={metric.label}><span className="metric-label">{metric.label}</span><span data-long={amount.length > 11 || undefined} className={`metric-value ${amountSizeClass(amount, "text-xs", "text-sm")} sm:text-xl font-bold ${metric.ink} tabular-nums`}>{amount}</span></div>;
          })}</div>
        </section>
        <section className="overview-trend panel" aria-labelledby="trend-heading">
          <div className="panel-heading"><h2 id="trend-heading">{trendMetric === "revenue" ? t.dailyTrend : t.dailyCostTrend}</h2><span className="record-count">{t.recordedDays}: {trend.length}</span></div>
          <div className="metric-tabs" aria-label={t.trendMetric}>{(["revenue", "cost"] as const).map(metric => <button key={metric} type="button" aria-pressed={trendMetric === metric} onClick={() => setTrendMetric(metric)}>{metric === "revenue" ? t.sheetRevCol : t.sheetCostCol}</button>)}</div>
          {!trend.length ? <div className="empty-state"><p>{t.noDailyEntries}</p><Link className="secondary-button" href="/">{t.recordToday}</Link></div> : <>
            <div className="trend-range"><span>MYR</span><span>0 – {formatMyr(BigInt(maximum))}</span></div>
            <svg key={trendMetric} className="trend-plot animate-chart-swap" viewBox={`0 0 ${chartW} ${chartH}`} aria-hidden="true" focusable="false">
              <defs><linearGradient id={`trendGradient-${trendMetric}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={chartColor} stopOpacity="0.18" /><stop offset="100%" stopColor={chartColor} stopOpacity="0.01" /></linearGradient></defs>
              {[padY, chartH / 2, chartH - padY].map(y => <line key={y} x1={padX} x2={chartW - padX} y1={y} y2={y} stroke="rgb(var(--border))" vectorEffect="non-scaling-stroke" />)}
              <path d={area} fill={`url(#trendGradient-${trendMetric})`} />
              <path d={line} fill="none" stroke={chartColor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              {points.map((point, index) => <circle key={trend[index].date} className="point-circle transition-[r,fill]" cx={point.x} cy={point.y} r="3.5" fill={chartColor} stroke="rgb(var(--surface))" vectorEffect="non-scaling-stroke" />)}
            </svg>
            <div className="trend-dates"><span>{trend[0].date}</span><span>{trend[trend.length - 1].date}</span></div>
            <details className="daily-records"><summary>{t.viewDailySheets} <span>{trend.length}<span aria-hidden="true"> ↗</span></span></summary><p className="sr-only">{t.chartDataBelow}</p><div>{trend.map(row => <Link key={row.date} href={`/?date=${row.date}`} className="daily-record"><span>{row.date}</span><span><small>{metricLabel}</small>{formatMyr(BigInt(trendValueSen(row, trendMetric)))}<span aria-hidden="true"> ›</span></span></Link>)}</div></details>
          </>}
        </section>
        {(Boolean(split?.totalSen) || costs.length > 0) && <div className="overview-composition">
          <section className="overview-split panel" aria-labelledby="split-heading"><h2 id="split-heading">{t.revenueSplit}</h2>
            {!split?.totalSen ? <p className="empty-note">{t.noRevenueData}</p> : <>
              <div className="split-bar" aria-hidden="true"><span className="split-cash" style={{ width: `${cashPct}%` }} /><span className="split-tng" style={{ width: `${tngPct}%` }} /></div>
              <dl className="channel-totals"><div><dt><i className="split-cash" />{t.cashRevenue}<small>{cashPct}%</small></dt><dd>{formatMyr(BigInt(split.cashSen))}</dd></div><div><dt><i className="split-tng" />{t.tngRevenue}<small>{tngPct}%</small></dt><dd>{formatMyr(BigInt(split.tngSen))}</dd></div></dl>
            </>}
          </section>
          <section className="overview-costs panel" aria-labelledby="cost-heading"><h2 id="cost-heading">{t.costDistribution}</h2>
            {!costs.length ? <p className="empty-note">{t.noCostData}</p> : <div className="cost-composition">
              <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false" className="cost-donut">{slices.map(slice => {
                const shape = getDonutSlice(100, 100, 94, 48, slice.start, slice.end);
                return <g key={slice.cat}><path d={shape.d} fill={slice.hex} stroke="rgb(var(--surface))" strokeWidth="2.5" />{slice.pct >= 8 && <text x={shape.tx} y={shape.ty} textAnchor="middle" dominantBaseline="central" fill={chartLabelInk(slice.hex)} fontWeight="500" fontSize="15">{slice.pct}%</text>}</g>;
              })}</svg>
              <dl className="category-totals">{costs.map(item => <div key={item.cat}><dt><i style={{ backgroundColor: item.hex }} />{item.label}<small>{item.pct}%</small></dt><dd>{formatMyr(BigInt(item.amountSen))}</dd></div>)}</dl>
            </div>}
          </section>
        </div>}
      </>}
    </div>
  );
}
