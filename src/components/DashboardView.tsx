"use client";

import { ChannelIcon } from "./ChannelIcon";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { ActionIcon } from "./ActionIcon";
import { amountSizeClass, formatMyr, isLongAmount } from "@/lib/money";
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

/** Theme-aware trend colours. */
const TREND_METRIC_COLORS: Record<
  TrendMetric,
  { line: string; active: string; halo: string }
> = {
  revenue: { line: "var(--trend-revenue, #126756)", active: "#126756", halo: "#e5f1ec" },
  cost: { line: "var(--trend-cost, #485b52)", active: "#485b52", halo: "#dfe5df" },
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
  loading?: boolean;
}

export function DashboardView({ tiles, activeMonth, activeTile, trend, split, costByCategory, loadError, loading = false }: DashboardViewProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("revenue");
  const trendPanelId = React.useId();
  const [chartW, setChartW] = useState(600);
  const chartRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setChartW(Math.max(1, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [trend.length]);
  const labels: Record<keyof SerializedCostByCategory, string> = {
    restock: t.catRestock, gas: t.catGas, transport: t.catTransport,
    "wages-daily": t.catWagesDaily, maintenance: t.catMaintenance, other: t.catOther,
  };
  const totalCosts = costByCategory ? Object.values(costByCategory).reduce((sum, value) => sum + value, 0) : 0;
  const costs = (Object.keys(labels) as Array<keyof SerializedCostByCategory>)
    .map(cat => ({ cat, label: labels[cat], amountSen: costByCategory?.[cat] ?? 0, pct: totalCosts > 0 ? Math.round((costByCategory![cat] / totalCosts) * 100) : 0 }))
    .filter(item => item.amountSen > 0);
  const headline = activeTile ? formatMyr(BigInt(activeTile.netSen)) : formatMyr(0n);
  const isProfitPositive = !activeTile || BigInt(activeTile.netSen) >= 0n;
  const metrics = [
    { kind: "revenue", label: t.totalRevenue, value: activeTile?.revenueSen ?? 0, ink: "text-ink-primary" },
    { kind: "daily-cost", label: t.costsTitle, value: activeTile?.dailyCostSen ?? 0, ink: "text-ink-secondary" },
    { kind: "operating", label: t.operatingExpenses, value: activeTile?.operatingSen ?? 0, ink: "text-ink-secondary" },
  ];
  const noActivity = trend.length === 0 && metrics.every(metric => metric.value === 0);
  const cashPct = split?.totalSen ? Math.round(split.cashSen / split.totalSen * 100) : 0;
  const tngPct = split?.totalSen ? 100 - cashPct : 0;
  const metricLabel = t.sheetRevCol;
  const chartH = 160, padX = 16, padY = 28;
  const maximum = Math.max(1000, ...trend.flatMap(row => [row.totalSen, row.costSen]));
  const firstDate = trend.length ? Date.parse(`${trend[0].date}T00:00:00Z`) : 0;
  const dateSpan = trend.length > 1 ? Math.max(1, Date.parse(`${trend[trend.length - 1].date}T00:00:00Z`) - firstDate) : 1;
  const points = trend.map(row => ({
    x: trend.length === 1 ? chartW / 2 : padX + (Date.parse(`${row.date}T00:00:00Z`) - firstDate) / dateSpan * (chartW - padX * 2),
    y: chartH - padY - trendValueSen(row, trendMetric) / maximum * (chartH - padY * 2),
  }));
  const line = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = points.length ? `${line} L ${points[points.length - 1].x} ${chartH - padY} L ${points[0].x} ${chartH - padY} Z` : "";
  const chartColor = TREND_METRIC_COLORS[trendMetric].line;
  return (
    <div className={`dashboard-layout page-stack ${trend.length ? "has-records" : "no-records"}`}>
      <div className="page-heading">
        <div><h1>{t.overviewTitle}</h1><p className="page-description">{t.overviewHint}</p></div>
        <MonthSelectorDropdown loadingLabel={loading ? t.loadingShort : undefined} currentMonth={activeMonth} options={tiles.map(tile => ({ month: tile.month, status: tile.status }))} onSelect={month => router.push(`/dashboard?month=${month}`)} />
      </div>
      {loadError ? <div role="alert" className="page-error">{t.loadError}<p>{loadError}</p></div> : <>
        {!trend.length && <section className="empty-month panel"><h2>{t.noDailyEntries}</h2><p>{t.emptyMonthHint}</p><Link className="primary-button" href="/" aria-label={t.recordDailySheet} title={t.recordDailySheet}><ActionIcon name="record" size={24} /></Link></section>}
        <section className={`overview-summary panel${noActivity ? " is-empty" : ""}`} hidden={noActivity} aria-label={t.monthSummary}>
          <div className={`profit-headline${isProfitPositive ? "" : " is-loss"}`}>
            <h2>{t.netProfit}<span className="profit-status sr-only">{!activeTile?.netSen ? t.evenStatus : isProfitPositive ? t.profitStatus : t.lossStatus}</span></h2>
            <span data-zero={!activeTile?.netSen || undefined} data-long={isLongAmount(headline) || undefined} className={`metric-headline ${amountSizeClass(headline, "text-2xl", "text-3xl")} sm:text-4xl font-extrabold tracking-tight tabular-nums ${isProfitPositive ? "text-finance-profit" : "text-finance-loss"}`}>{headline}</span>
            <p className="sr-only">{t.netProfitFormula}</p>
          </div>
          {!noActivity && <div className="summary-metrics">{metrics.map(metric => {
            const amount = formatMyr(BigInt(metric.value) * (metric.kind === "revenue" ? 1n : -1n));
            return <div className={`summary-metric metric-${metric.kind}`} key={metric.label}><span className="metric-label">{metric.label}</span><span data-long={amount.length > 12 || undefined} data-very-long={amount.length > 14 || undefined} className={`metric-value ${amountSizeClass(amount, "text-xs", "text-sm")} sm:text-xl font-bold ${metric.ink} tabular-nums`}>{amount}</span></div>;
          })}</div>}
        </section>
        <Link className="month-close-action" href={`/close?month=${activeMonth}`}>
          <span className="month-close-icon" aria-hidden="true"><ActionIcon name="monthClose" size={23} /></span>
          <span><strong>{t.closeMonthAction}</strong><small className="sr-only">{t.closeMonthHint}</small></span><span className="action-arrow" aria-hidden="true"><ActionIcon name="chevronRight" size={20} /></span>
        </Link>
        {trend.length > 0 && <details className="daily-records daily-ledger" open={trend.length <= 7}><summary><span className="daily-record-heading">{t.dailySheetsLabel}<small>{metricLabel}</small></span><span className="daily-record-counter" aria-label={`${trend.length} ${t.recordedDays}`}>{trend.length}{t.daysUnit}<span className="ledger-chevron" aria-hidden="true"><ActionIcon name="chevronDown" size={20} /></span></span></summary><p className="sr-only">{t.chartDataBelow}</p><div>{trend.map(row => <Link key={row.date} href={`/?date=${row.date}`} className="daily-record"><span>{row.date}</span><span><small className="sr-only">{metricLabel}</small>{formatMyr(BigInt(row.totalSen))}<span className="daily-record-arrow" aria-hidden="true"><ActionIcon name="chevronRight" size={16} /></span></span></Link>)}</div></details>}
        {trend.length > 0 && <section className="overview-trend panel" aria-labelledby="trend-heading">
          <div className="metric-tabs" role="tablist" aria-label={t.trendMetric}>
            {(["revenue", "cost"] as const).map(metric => <button
              key={metric} type="button" role="tab" disabled={loading} id={`${trendPanelId}-${metric}`}
              data-metric={metric} aria-controls={trendPanelId} aria-selected={trendMetric === metric}
              tabIndex={trendMetric === metric ? 0 : -1}
              onClick={() => setTrendMetric(metric)}
              onKeyDown={event => {
                let next: TrendMetric;
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") next = metric === "revenue" ? "cost" : "revenue";
                else if (event.key === "Home") next = "revenue";
                else if (event.key === "End") next = "cost";
                else return;
                event.preventDefault();
                setTrendMetric(next);
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-metric="${next}"]`)?.focus();
              }}
            >{metric === "revenue" ? t.sheetRevCol : t.sheetCostCol}</button>)}
          </div>
          <div className="trend-panel" role="tabpanel" id={trendPanelId} aria-labelledby={`${trendPanelId}-${trendMetric}`}>
            <div className="panel-heading"><h2 id="trend-heading">{trendMetric === "revenue" ? t.dailyTrend : t.dailyCostTrend}</h2></div>
            <div className="trend-scale">{formatMyr(BigInt(maximum))}</div>
            <div className="trend-frame" ref={chartRef}><svg key={trendMetric} className="trend-plot animate-chart-swap" viewBox={`0 0 ${chartW} ${chartH}`} aria-hidden="true" focusable="false">
              <defs><linearGradient id={`trendGradient-${trendMetric}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={chartColor} stopOpacity="0.18" /><stop offset="100%" stopColor={chartColor} stopOpacity="0.01" /></linearGradient></defs>
              {[padY, chartH / 2, chartH - padY].map(y => <line key={y} x1={padX} x2={chartW - padX} y1={y} y2={y} stroke="rgb(var(--border))" vectorEffect="non-scaling-stroke" />)}
              <text x="0" y={chartH - padY + 4} fill="rgb(var(--secondary))" fontSize="14">0</text>
              <path d={area} fill={`url(#trendGradient-${trendMetric})`} />
              <path d={line} fill="none" stroke={chartColor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              {points.map((point, index) => {
                const label = formatMyr(BigInt(trendValueSen(trend[index], trendMetric)));
                const single = points.length === 1;
                const nearestPoint = Math.min(index ? point.x - points[index - 1].x : Infinity, index < points.length - 1 ? points[index + 1].x - point.x : Infinity);
                const labelSpace = single ? chartW - padX * 2 : points.length <= 3 ? nearestPoint * .66 : (chartW - padX * 2) / 2;
                // Exact values remain in the dated records; omit labels that would collide.
                const showLabel = label.length * 8.5 <= labelSpace && (index === 0 || index === points.length - 1 || (points.length <= 3 && chartW >= 280));
                return <g key={trend[index].date}><circle className="point-circle transition-[r,fill]" cx={point.x} cy={point.y} r="3.5" fill={chartColor} stroke="rgb(var(--surface))" vectorEffect="non-scaling-stroke" />{showLabel && <text x={point.x} y={point.y - 14} textAnchor={single ? "middle" : index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} className="trend-value-label" fill="rgb(var(--ink))" fontSize="14" fontWeight="500">{label}</text>}</g>;
              })}
            </svg></div>
            {trend.length <= 3 ? <div className="trend-dates trend-dates-sparse">{trend.map((row, index) => <span key={row.date} style={{ left: `${trend.length === 1 ? 50 : index === 0 ? 0 : index === trend.length - 1 ? 100 : points[index].x / chartW * 100}%`, transform: trend.length === 1 || index > 0 && index < trend.length - 1 ? "translateX(-50%)" : index === trend.length - 1 ? "translateX(-100%)" : undefined }}>{row.date.slice(5)}</span>)}</div> : <div className="trend-dates"><span>{trend[0].date.slice(5)}</span><span>{trend[trend.length - 1].date.slice(5)}</span></div>}

            <p className="trend-scope">{t.recordedDatesOnly}</p>
          </div>
        </section>}
        {(Boolean(split?.totalSen) || costs.length > 0) && <div className="overview-composition">
          <section className="overview-split panel" aria-labelledby="split-heading"><h2 id="split-heading">{t.revenueSplit}</h2>
            {!split?.totalSen ? <p className="empty-note">{t.noRevenueData}</p> : <>
              <dl className="account-balances"><div className="cash-account"><dt><span aria-hidden="true"><ChannelIcon channel="cash" /></span>{t.cashRevenueShort}</dt><dd>{formatMyr(BigInt(split.cashSen))}</dd><small>{cashPct}%</small></div><div className="tng-account"><dt><span aria-hidden="true"><ChannelIcon channel="tng" /></span>{t.tngRevenueShort}</dt><dd>{formatMyr(BigInt(split.tngSen))}</dd><small>{tngPct}%</small></div></dl>
            </>}
          </section>
          <section className="overview-costs panel" aria-labelledby="cost-heading"><h2 id="cost-heading">{t.costDistribution}</h2>
            {!costs.length ? <p className="empty-note">{t.noCostData}</p> : <dl className="cost-bars">{costs.map(item => <div className="cost-bar-row" key={item.cat}>
              <div className="cost-bar-values"><dt>{item.label}</dt><dd>{formatMyr(BigInt(item.amountSen))}</dd></div>
              <div className="cost-bar-meter"><div className="cost-bar-track" aria-hidden="true"><span style={{ width: `${item.pct}%` }} /></div><small>{item.pct}%</small></div>
            </div>)}</dl>}
          </section>
        </div>}
      </>}
    </div>
  );
}
