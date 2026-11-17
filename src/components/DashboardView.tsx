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
const TREND_METRIC_COLORS: Record<TrendMetric, string> = {
  revenue: "var(--trend-revenue, #126756)",
  cost: "var(--trend-cost)",
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
    .filter(item => item.amountSen > 0)
    .sort((a, b) => b.amountSen - a.amountSen);
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
  const revenueTotal = formatMyr(BigInt(split?.totalSen ?? 0));
  const costTotal = formatMyr(BigInt(totalCosts));
  const metricLabel = t.sheetRevCol;
  const chartH = 160, padRight = 12, padY = 28;
  const observedMaximum = Math.max(1000, ...trend.map(row => trendValueSen(row, trendMetric)));
  const scaleStep = 10 ** Math.floor(Math.log10(observedMaximum)) / 2;
  const maximum = Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(observedMaximum * 1.15 / scaleStep) * scaleStep);
  const maximumLabel = formatMyr(BigInt(maximum)).replace(/^RM /, "").replace(/\.00$/, "");
  const padLeft = Math.max(40, maximumLabel.length * 9 + 12);
  const columnStep = (chartW - padLeft - padRight) / Math.max(1, trend.length);
  const columnWidth = Math.min(40, columnStep * .48);
  const points = trend.map((row, index) => ({
    x: padLeft + (index + .5) * columnStep,
    y: chartH - padY - trendValueSen(row, trendMetric) / maximum * (chartH - padY * 2),
  }));
  const chartColor = TREND_METRIC_COLORS[trendMetric];
  const valueLabel = (index: number) => formatMyr(BigInt(trendValueSen(trend[index], trendMetric))).replace(/^RM /, "");
  const labelWidthAt = (index: number) => valueLabel(index).length * 9 + 4;
  const labelled = (index: number) => trend.length <= 3 || index === 0 || index === trend.length - 1 || index === peakIndex;
  // A labelled day's value and date share one centre, kept inside the plot.
  const labelX = (index: number) => {
    if (trend.length <= 3) return points[index].x;
    const half = Math.max(labelWidthAt(index), 50) / 2;
    return Math.min(Math.max(points[index].x, padLeft + half), chartW - padRight - half);
  };
  const trendTotal = trend.reduce((sum, row) => sum + trendValueSen(row, trendMetric), 0);
  // In a busy month the peak day also gets its value, when it clears the first and last labels.
  const peakIndex = (() => {
    if (trend.length <= 3) return -1;
    let best = 0;
    trend.forEach((row, index) => { if (trendValueSen(row, trendMetric) > trendValueSen(trend[best], trendMetric)) best = index; });
    if (best === 0 || best === trend.length - 1) return -1;
    const half = Math.max(labelWidthAt(best), 50) / 2, x = points[best].x;
    return x - half >= points[0].x + Math.max(labelWidthAt(0), 50) + 8 && x + half <= points[points.length - 1].x - Math.max(labelWidthAt(points.length - 1), 50) - 8 ? best : -1;
  })();
  return (
    <div className={`dashboard-layout page-stack ${trend.length ? "has-records" : "no-records"}`}>
      <div className="page-heading">
        <div><h1>{t.overviewTitle}</h1><p className="page-description">{t.overviewHint}</p></div>
        <MonthSelectorDropdown loadingLabel={loading ? t.loadingShort : undefined} currentMonth={activeMonth} options={tiles.map(tile => ({ month: tile.month, status: tile.status }))} onSelect={month => router.push(`/dashboard?month=${month}`)} />
      </div>
      {loadError ? <div role="alert" className="page-error">{t.loadError}<p>{loadError}</p></div> : <>
        {!trend.length && <section className="empty-month panel"><h2>{t.noDailyEntries}</h2><p>{t.emptyMonthHint}</p><Link className="primary-button" href="/" aria-label={t.recordDailySheet} title={t.recordDailySheet}><ActionIcon name="add" size={24} /><ActionIcon name="record" size={24} /></Link></section>}
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
        {trend.length > 0 && <details className="daily-records daily-ledger" open={trend.length <= 7}><summary><span className="daily-record-heading">{t.dailySheetsLabel}<small className="daily-record-counter" aria-label={`${trend.length} ${t.recordedDays}`}>{trend.length}{t.daysUnit}</small></span><span className="ledger-chevron" aria-hidden="true"><ActionIcon name="chevronDown" size={20} /></span></summary><p className="sr-only">{t.chartDataBelow}</p><div>{trend.map(row => <Link key={row.date} href={`/?date=${row.date}`} className="daily-record"><span>{row.date}</span><span data-long={isLongAmount(formatMyr(BigInt(row.totalSen))) || undefined}><small className="sr-only">{metricLabel}</small>{formatMyr(BigInt(row.totalSen))}<span className="daily-record-arrow" aria-hidden="true"><ActionIcon name="chevronRight" size={16} /></span></span></Link>)}</div></details>}
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
            <div className="panel-heading">
              <h2 id="trend-heading" className="sr-only">{trendMetric === "revenue" ? t.dailyTrend : t.dailyCostTrend}</h2>
              <span className="trend-unit" style={{width:padLeft-8}}>RM</span>
              <span className="trend-total">{t.periodTotal}<strong>{formatMyr(BigInt(trendTotal))}</strong></span>
            </div>
            <div className="trend-frame" ref={chartRef}><svg key={trendMetric} className="trend-plot animate-chart-swap" data-maximum={maximum} viewBox={`0 0 ${chartW} ${chartH}`} aria-hidden="true" focusable="false">
              <line x1={padLeft} x2={padLeft} y1={padY} y2={chartH-padY} stroke="rgb(var(--border))" vectorEffect="non-scaling-stroke" />
              <line x1={padLeft-4} x2={padLeft} y1={padY} y2={padY} stroke="rgb(var(--border))" vectorEffect="non-scaling-stroke" />
              <line x1={padLeft} x2={chartW-padRight} y1={chartH-padY} y2={chartH-padY} stroke="rgb(var(--border))" vectorEffect="non-scaling-stroke" />
              <text className="trend-axis-label trend-axis-maximum" x={padLeft - 8} y={padY + 4} textAnchor="end" fill="rgb(var(--ink))" fontSize="14" fontWeight="600">{maximumLabel}</text>
              <text className="trend-axis-label" x={padLeft - 8} y={chartH - padY + 4} textAnchor="end" fill="rgb(var(--secondary))" fontSize="14">0</text>
              {points.map((point, index) => {
                const label = valueLabel(index);
                const labelWidth = labelWidthAt(index);
                const labelSpace = points.length <= 3 ? columnStep * .9 : (chartW - padLeft - padRight) / 2;
                // Exact values are also available in the accessible dated list below.
                const showLabel = labelWidth <= labelSpace && (index === 0 || index === points.length - 1 || index === peakIndex || points.length <= 3);
                // In a busy month the labelled days stay full colour so each value points at its bar.
                return <g key={trend[index].date}><rect className="trend-column" x={point.x - columnWidth / 2} y={point.y} width={columnWidth} height={chartH - padY - point.y} rx="4" fill={chartColor} fillOpacity={labelled(index) ? 1 : .45} />{showLabel && <text x={labelX(index)} y={chartH - padY + 24} textAnchor="middle" className="trend-value-label" fill="rgb(var(--ink))" fontSize="16" fontWeight="500">{label}</text>}</g>;
              })}
            </svg></div>
            <dl className="sr-only">{trend.map(row => <div key={row.date}><dt>{row.date}</dt><dd>{formatMyr(BigInt(trendValueSen(row, trendMetric)))}</dd></div>)}</dl>
            <div className="trend-dates trend-dates-sparse">{(trend.length <= 3 ? trend.map((row, index) => ({ row, point: points[index] })) : [0, ...(peakIndex > 0 ? [peakIndex] : []), trend.length - 1].map(index => ({ row: trend[index], point: { x: labelX(index) } }))).map(({ row, point }) => <span key={row.date} style={{ left: `${point.x / chartW * 100}%`, transform: "translateX(-50%)" }}>{row.date.slice(5)}</span>)}</div>

            <p className="trend-scope">{t.recordedDatesOnly}</p>
          </div>
        </section>}
        {(Boolean(split?.totalSen) || costs.length > 0) && <div className="overview-composition">
          <section className="overview-split panel" aria-labelledby="split-heading"><div className="composition-heading"><h2 id="split-heading">{t.revenueSplit}</h2><strong className={`composition-total${loading ? " skeleton-value" : ""}`} data-long={isLongAmount(revenueTotal)||undefined}>{revenueTotal}</strong></div>
            {!split?.totalSen ? <p className="empty-note">{t.noRevenueData}</p> : <div className="revenue-composition">
              <div className="revenue-donut" aria-hidden="true">
                <svg viewBox="0 0 128 128"><circle cx="64" cy="64" r="55" fill="none" stroke="rgb(var(--tng))" strokeWidth="16" /><circle cx="64" cy="64" r="55" fill="none" stroke="rgb(var(--cash))" strokeWidth="16" pathLength="100" strokeDasharray={`${cashPct} 100`} transform="rotate(-90 64 64)" /></svg>
                <div className="revenue-donut-center"><strong>{cashPct}%</strong><span>{t.cashRevenueShort}</span></div>
              </div>
              <dl className="account-balances"><div className="cash-account"><dt><span aria-hidden="true"><ChannelIcon channel="cash" /></span>{t.cashRevenueShort}</dt><dd data-long={isLongAmount(formatMyr(BigInt(split.cashSen))) || undefined}>{formatMyr(BigInt(split.cashSen))}</dd><small>{cashPct}%</small></div><div className="tng-account"><dt><span aria-hidden="true"><ChannelIcon channel="tng" /></span>{t.tngRevenueShort}</dt><dd data-long={isLongAmount(formatMyr(BigInt(split.tngSen))) || undefined}>{formatMyr(BigInt(split.tngSen))}</dd><small>{tngPct}%</small></div></dl>
            </div>}
          </section>
          <section className="overview-costs panel" aria-labelledby="cost-heading"><div className="composition-heading"><h2 id="cost-heading">{t.costDistribution}</h2><strong className={`composition-total${loading ? " skeleton-value" : ""}`} data-long={isLongAmount(costTotal)||undefined}>{costTotal}</strong></div>
            {!costs.length ? <p className="empty-note">{t.noCostData}</p> : <dl className="cost-bars">{costs.map(item => <div className="cost-bar-row" key={item.cat}>
              <div className="cost-bar-values"><dt><i className="cost-bar-dot" style={{ background: `var(--cat-${item.cat})` }} aria-hidden="true" />{item.label}</dt><dd>{formatMyr(BigInt(item.amountSen))}</dd></div>
              <div className="cost-bar-meter"><div className="cost-bar-track" aria-hidden="true"><span style={{ width: `${item.pct}%`, background: `var(--cat-${item.cat})` }} /></div><small>{item.pct}%</small></div>
            </div>)}</dl>}
          </section>
        </div>}
      </>}
    </div>
  );
}
