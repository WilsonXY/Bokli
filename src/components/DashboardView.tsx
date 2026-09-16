"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { formatMyr } from "@/lib/money";
import { MonthSelectorDropdown } from "@/components/MonthSelectorDropdown";

export interface SerializedMonthTile {
  month: string;
  revenueSen: number;
  dailyCostSen: number;
  grossSen: number;
  operatingSen: number;
  netSen: number;
  status: "open" | "closed" | "reopened";
  balanced?: boolean;
}

export interface SerializedDailyTrendRow {
  date: string;
  cashSen: number;
  tngSen: number;
  totalSen: number;
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

export function DashboardView({
  tiles,
  activeMonth,
  activeTile,
  trend,
  split,
  costByCategory,
  loadError,
}: DashboardViewProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [activeDate, setActiveDate] = useState<string | null>(null);

  const totalRev = split ? BigInt(split.totalSen) : 0n;
  const cashPct =
    totalRev > 0n && split ? Math.round((Number(split.cashSen) * 100) / Number(totalRev)) : 0;
  const tngPct = totalRev > 0n ? 100 - cashPct : 0;

  const totalCosts = costByCategory
    ? costByCategory.restock +
      costByCategory.gas +
      costByCategory.transport +
      costByCategory["wages-daily"] +
      costByCategory.maintenance +
      costByCategory.other
    : 0;

  const categoryLabels: Record<keyof SerializedCostByCategory, string> = {
    restock: t.catRestock,
    gas: t.catGas,
    transport: t.catTransport,
    "wages-daily": t.catWagesDaily,
    maintenance: t.catMaintenance,
    other: t.catOther,
  };

  const statusLabel = (status?: "open" | "closed" | "reopened") => {
    switch (status) {
      case "closed":
        return t.closedStatus;
      case "reopened":
        return t.reopenedStatus;
      default:
        return t.openStatus;
    }
  };

  const isProfitPositive = activeTile ? BigInt(activeTile.netSen) >= 0n : true;

  const categoryPalette: Record<keyof SerializedCostByCategory, { bg: string; hex: string }> = {
    restock: { bg: "bg-blue-600", hex: "#2563eb" },
    gas: { bg: "bg-amber-500", hex: "#f59e0b" },
    transport: { bg: "bg-purple-600", hex: "#9333ea" },
    "wages-daily": { bg: "bg-rose-500", hex: "#f43f5e" },
    maintenance: { bg: "bg-teal-600", hex: "#0d9488" },
    other: { bg: "bg-slate-500", hex: "#64748b" },
  };

  const costEntries = (
    Object.keys(categoryLabels) as Array<keyof SerializedCostByCategory>
  )
    .map((cat) => {
      const amount = costByCategory ? costByCategory[cat] : 0;
      const pct = totalCosts > 0 ? Math.round((amount / totalCosts) * 100) : 0;
      return {
        cat,
        label: categoryLabels[cat],
        amount,
        pct,
        ...categoryPalette[cat],
      };
    })
    .filter((entry) => entry.amount > 0);

  function getDonutSlice(
    cx: number,
    cy: number,
    rOuter: number,
    rInner: number,
    startPct: number,
    endPct: number
  ) {
    let startAngle = startPct * 360;
    let endAngle = endPct * 360;
    if (endAngle - startAngle >= 360) {
      endAngle = startAngle + 359.99;
    }

    const startRad = ((startAngle - 90) * Math.PI) / 180;
    const endRad = ((endAngle - 90) * Math.PI) / 180;
    const midRad = (((startAngle + endAngle) / 2 - 90) * Math.PI) / 180;

    const x1 = cx + rOuter * Math.cos(startRad);
    const y1 = cy + rOuter * Math.sin(startRad);
    const x2 = cx + rOuter * Math.cos(endRad);
    const y2 = cy + rOuter * Math.sin(endRad);

    const x2In = cx + rInner * Math.cos(endRad);
    const y2In = cy + rInner * Math.sin(endRad);
    const x1In = cx + rInner * Math.cos(startRad);
    const y1In = cy + rInner * Math.sin(startRad);

    const largeArc = endAngle - startAngle > 180 ? 1 : 0;

    const d = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rOuter.toFixed(2)} ${rOuter.toFixed(2)} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x2In.toFixed(2)} ${y2In.toFixed(2)} A ${rInner.toFixed(2)} ${rInner.toFixed(2)} 0 ${largeArc} 0 ${x1In.toFixed(2)} ${y1In.toFixed(2)} Z`;

    const rMid = (rOuter + rInner) / 2;
    const tx = cx + rMid * Math.cos(midRad);
    const ty = cy + rMid * Math.sin(midRad);

    return { d, tx, ty };
  }

  let sliceAcc = 0;
  const costSlices = costEntries.map((entry) => {
    const start = sliceAcc;
    sliceAcc += entry.pct / 100;
    const end = Math.min(sliceAcc, 1);
    return {
      ...entry,
      start,
      end,
    };
  });

  // Daily Trend Line Chart calculation
  const trendAmounts = trend.map((r) => r.totalSen);
  const trendMax = trendAmounts.length > 0 ? Math.max(...trendAmounts) : 0;
  const trendMin = trendAmounts.length > 0 ? Math.min(...trendAmounts) : 0;
  const trendSpan = Math.max(trendMax - trendMin, 1);
  const chartYMin = Math.max(0, trendMin - trendSpan * 0.15);
  const chartYMax = trendMax + trendSpan * 0.15;
  const chartYSpan = Math.max(chartYMax - chartYMin, 1);

  const chartW = 460;
  const chartH = 105;
  const padX = 24;
  const padTop = 16;
  const padBot = 20;
  const usableW = chartW - 2 * padX;
  const usableH = chartH - padTop - padBot;

  const trendCoords = trend.map((r, i) => {
    const x = trend.length > 1 ? padX + (i / (trend.length - 1)) * usableW : chartW / 2;
    const y = padTop + (1 - (r.totalSen - chartYMin) / chartYSpan) * usableH;
    return {
      date: r.date,
      totalSen: r.totalSen,
      shortDate: r.date.slice(5),
      x,
      y,
    };
  });

  const trendLinePath =
    trendCoords.length > 0
      ? `M ${trendCoords[0].x.toFixed(1)} ${trendCoords[0].y.toFixed(1)} ` +
        trendCoords
          .slice(1)
          .map((pt) => `L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
          .join(" ")
      : "";

  const trendAreaPath =
    trendCoords.length > 0
      ? `${trendLinePath} L ${trendCoords[trendCoords.length - 1].x.toFixed(1)} ${(chartH - padBot).toFixed(1)} L ${trendCoords[0].x.toFixed(1)} ${(chartH - padBot).toFixed(1)} Z`
      : "";

  const highlightedPoint = trendCoords.find((pt) => pt.date === activeDate);

  return (
    <div className="space-y-4">
      {/* Page Header & Month Selector */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink-primary tracking-tight">
          月度概况
        </h1>

        <MonthSelectorDropdown
          currentMonth={activeMonth}
          options={tiles.map((tile) => ({
            month: tile.month,
            status: tile.status,
          }))}
          onSelect={(month) => router.push(`/dashboard?month=${month}`)}
        />
      </div>

      {loadError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="p-4 rounded-xl bg-finance-loss-light border border-finance-loss-border text-finance-loss space-y-2 shadow-xs"
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <h3 className="text-sm font-bold text-finance-loss">{t.loadError}</h3>
          </div>
          <p className="text-xs text-ink-secondary">{loadError}</p>
        </div>
      ) : (
        <>
          {/* Month Financial Health Summary (Clean Ledger Architecture, No Nested Cards) */}
          {activeTile && (
            <section className="bg-white border border-surface-border rounded-xl shadow-xs overflow-hidden">
              {/* Net Profit Spotlight */}
              <div className="px-5 py-4 sm:px-6 sm:py-5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-base font-bold text-ink-secondary">
                    {t.netProfit}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span
                    className={`text-3xl sm:text-4xl font-extrabold tracking-tight tabular-nums ${
                      isProfitPositive ? "text-emerald-700" : "text-rose-600"
                    }`}
                  >
                    {formatMyr(BigInt(activeTile.netSen))}
                  </span>
                </div>
              </div>

              {/* 3-Way Sub-metrics Strip (Further Enhanced Text Size) */}
              <div className="grid grid-cols-3 divide-x divide-surface-border border-t border-surface-border bg-surface-canvas/60">
                <div className="px-3.5 py-3 sm:px-5 sm:py-3.5">
                  <span className="block text-sm font-bold text-ink-secondary truncate">
                    {t.totalRevenue}
                  </span>
                  <span className="mt-1 block text-base sm:text-xl font-bold text-ink-primary tabular-nums truncate">
                    {formatMyr(BigInt(activeTile.revenueSen))}
                  </span>
                </div>

                <div className="px-3.5 py-3 sm:px-5 sm:py-3.5">
                  <span className="block text-sm font-bold text-ink-secondary truncate">
                    {t.costsTitle}
                  </span>
                  <span className="mt-1 block text-base sm:text-xl font-bold text-slate-700 tabular-nums truncate">
                    {formatMyr(BigInt(activeTile.dailyCostSen))}
                  </span>
                </div>

                <div className="px-3.5 py-3 sm:px-5 sm:py-3.5">
                  <span className="block text-sm font-bold text-ink-secondary truncate">
                    {t.operatingExpenses}
                  </span>
                  <span className="mt-1 block text-base sm:text-xl font-bold text-slate-700 tabular-nums truncate">
                    {formatMyr(BigInt(activeTile.operatingSen))}
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* Revenue Split: Cash vs Touch 'n Go */}
          <section className="bg-white border border-surface-border rounded-xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-ink-primary">
                {t.revenueSplit}
              </h2>
              {split && (
                <span className="text-base font-bold text-ink-primary tabular-nums">
                  {formatMyr(BigInt(split.totalSen))}
                </span>
              )}
            </div>

            {!split || totalRev === 0n ? (
              <div className="py-4 text-center text-xs text-ink-muted">
                {t.noRevenueData}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Visual Ratio Bar with Integrated Percentages */}
                <div className="w-full h-7 rounded-full overflow-hidden flex bg-surface-subtle p-0.5 shadow-inner">
                  <div
                    style={{ width: `${cashPct}%` }}
                    className="bg-emerald-600 h-full rounded-l-full flex items-center justify-center text-white text-xs font-bold tabular-nums tracking-wide transition-all duration-300 min-w-0 overflow-hidden"
                    title={`Cash: ${cashPct}%`}
                  >
                    {cashPct >= 12 ? `${cashPct}%` : ""}
                  </div>
                  <div
                    style={{ width: `${tngPct}%` }}
                    className="bg-blue-600 h-full rounded-r-full flex items-center justify-center text-white text-xs font-bold tabular-nums tracking-wide transition-all duration-300 min-w-0 overflow-hidden"
                    title={`TnG: ${tngPct}%`}
                  >
                    {tngPct >= 12 ? `${tngPct}%` : ""}
                  </div>
                </div>

                {/* Flat Ledger Rows (No Nested Cards) */}
                <div className="divide-y divide-surface-border border-t border-surface-border pt-1">
                  <div className="flex items-center justify-between py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 shrink-0" />
                      <span className="font-medium text-ink-secondary">
                        {t.cashRevenue}
                      </span>
                    </div>
                    <span className="font-bold text-ink-primary tabular-nums">
                      {formatMyr(BigInt(split.cashSen))}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
                      <span className="font-medium text-ink-secondary">
                        {t.tngRevenue}
                      </span>
                    </div>
                    <span className="font-bold text-ink-primary tabular-nums">
                      {formatMyr(BigInt(split.tngSen))}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Cost Distribution (Donut Chart & Ledger) */}
          <section className="bg-white border border-surface-border rounded-xl p-4 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-ink-primary">
                {t.costDistribution}
              </h2>
            </div>

            {totalCosts === 0 || costEntries.length === 0 ? (
              <div className="py-4 text-center text-xs text-ink-muted">
                {t.noCostData}
              </div>
            ) : (
              <div className="flex flex-col md:flex-row items-center gap-5 pt-1">
                {/* SVG Donut Chart with Embedded Slice Labels */}
                <div className="shrink-0 flex items-center justify-center p-1">
                  <div className="relative w-48 h-48 sm:w-52 sm:h-52 flex items-center justify-center drop-shadow-xs">
                    <svg viewBox="0 0 200 200" className="w-full h-full">
                      {costSlices.map((slice) => {
                        const { d, tx, ty } = getDonutSlice(100, 100, 94, 48, slice.start, slice.end);
                        return (
                          <g key={slice.cat}>
                            <path d={d} fill={slice.hex} stroke="#ffffff" strokeWidth="2.5" />
                            {slice.pct >= 6 && (
                              <text
                                x={tx}
                                y={ty}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fill="#ffffff"
                                fontWeight="700"
                                fontSize="13"
                                fontFamily="sans-serif"
                                className="select-none tracking-tight"
                              >
                                {slice.pct}%
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </svg>

                    {/* Center Hole Total */}
                    <div className="absolute w-24 h-24 sm:w-26 sm:h-26 rounded-full bg-white shadow-xs flex flex-col items-center justify-center text-center px-1 pointer-events-none border border-surface-border/50">
                      <span className="text-[10px] font-semibold text-ink-muted leading-tight">
                        {t.costsTitle}
                      </span>
                      <span className="text-xs font-bold text-ink-primary tabular-nums mt-0.5">
                        {formatMyr(BigInt(totalCosts))}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Clean Scannable Ledger (No Redundant Percentage Next to Text) */}
                <div className="flex-1 w-full divide-y divide-surface-border border-t md:border-t-0 md:border-l border-surface-border md:pl-5">
                  {costEntries.map((entry) => (
                    <div
                      key={entry.cat}
                      className="flex items-center justify-between py-2.5 text-sm"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`w-3 h-3 rounded-full ${entry.bg} shrink-0 ring-1 ring-black/10`}
                        />
                        <span className="font-medium text-ink-primary">
                          {entry.label}
                        </span>
                      </div>
                      <span className="font-bold text-ink-primary tabular-nums">
                        {formatMyr(BigInt(entry.amount))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Daily Trend (Line Chart + Ledger) */}
          <section className="bg-white border border-surface-border rounded-xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between pb-1">
              <h2 className="text-base font-bold text-ink-primary">
                {t.dailyTrend}
              </h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-subtle text-ink-secondary tabular-nums border border-surface-border">
                {trend.length} {t.dateCol}
              </span>
            </div>

            {trend.length === 0 ? (
              <div className="py-4 text-center text-xs text-ink-muted">
                {t.noDailyEntries}
              </div>
            ) : (
              <div className="space-y-4">
                {/* SVG Line Chart */}
                <div className="w-full overflow-x-auto pb-2">
                  <svg
                        viewBox={`0 0 ${chartW} ${chartH + 20}`}
                        className="w-full h-auto overflow-visible min-w-[340px]"
                        onPointerLeave={(e) => {
                          if (e.pointerType === "mouse") {
                            setActiveDate(null);
                          }
                        }}
                        onClick={(e) => {
                          if (e.target === e.currentTarget) {
                            setActiveDate(null);
                          }
                        }}
                      >
                        <defs>
                          <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
                          </linearGradient>
                          <filter id="shadowP1" x="-10%" y="-10%" width="130%" height="130%">
                            <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.1" />
                          </filter>
                        </defs>

                        {/* Area fill */}
                        {trendAreaPath && (
                          <path d={trendAreaPath} fill="url(#trendGradient)" />
                        )}

                        {/* Baseline */}
                        <line
                          x1={padX}
                          y1={chartH - padBot}
                          x2={chartW - padX}
                          y2={chartH - padBot}
                          stroke="#e2e8f0"
                          strokeWidth="1"
                        />

                        {/* Line stroke */}
                        {trendLinePath && (
                          <path
                            d={trendLinePath}
                            fill="none"
                            stroke="#2563eb"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}

                        {/* Base Data Points Layer */}
                        {trendCoords.map((pt, idx) => {
                          const isActive = activeDate === pt.date;
                          const isFirst = idx === 0;
                          const isLast = idx === trendCoords.length - 1;
                          const dayNum = parseInt(pt.date.slice(8), 10);
                          const showDate = isFirst || isLast || idx % 3 === 0 || isActive;
                          return (
                            <g
                              key={pt.date}
                              role="button"
                              aria-label={`${pt.date}: RM${(pt.totalSen / 100).toFixed(2)}`}
                              aria-pressed={isActive}
                              tabIndex={0}
                              className="chart-point-interactive"
                              style={{ touchAction: "manipulation" }}
                              onPointerEnter={(e) => {
                                if (e.pointerType === "mouse") {
                                  setActiveDate(pt.date);
                                }
                              }}
                              onTouchStart={(e) => {
                                const t = e.touches[0];
                                (e.currentTarget as unknown as { _touchStart: { x: number; y: number } })._touchStart = {
                                  x: t.clientX,
                                  y: t.clientY,
                                };
                              }}
                              onTouchEnd={(e) => {
                                const target = e.currentTarget as unknown as { _touchStart?: { x: number; y: number } };
                                const start = target._touchStart;
                                const t = e.changedTouches[0];
                                const dist = start ? Math.hypot(t.clientX - start.x, t.clientY - start.y) : 0;
                                if (dist < 12) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setActiveDate((prev) => (prev === pt.date ? null : pt.date));
                                }
                              }}
                              onFocus={() => setActiveDate(pt.date)}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveDate((prev) => (prev === pt.date ? null : pt.date));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setActiveDate((prev) => (prev === pt.date ? null : pt.date));
                                }
                              }}
                            >
                              <circle cx={pt.x} cy={pt.y} r="24" fill="transparent" />
                              <circle
                                cx={pt.x}
                                cy={pt.y}
                                r="10"
                                fill="#bfdbfe"
                                opacity={isActive ? "0.8" : "0.6"}
                                className={`point-guide ${isActive ? "opacity-100" : "opacity-0"} transition-opacity duration-150`}
                              />
                              <line
                                x1={pt.x}
                                y1={showDate ? chartH - 14 : chartH - 12}
                                x2={pt.x}
                                y2={chartH - 10}
                                stroke={isActive ? "#2563eb" : showDate ? "#cbd5e1" : "#e2e8f0"}
                                strokeWidth="1"
                              />
                              <circle
                                cx={pt.x}
                                cy={pt.y}
                                r={isActive ? "5.5" : "3.5"}
                                fill={isActive ? "#1d4ed8" : "#2563eb"}
                                stroke="#ffffff"
                                strokeWidth="1.5"
                                className="point-circle drop-shadow-xs transition-all duration-150"
                              />
                              {showDate && (
                                <text
                                  transform={`rotate(-45 ${pt.x} ${chartH + 2})`}
                                  x={pt.x}
                                  y={chartH + 2}
                                  textAnchor="end"
                                  fontSize="8.5"
                                  fontWeight={isActive ? "700" : "600"}
                                  fill={isActive ? "#0f172a" : "#64748b"}
                                  className="select-none transition-colors"
                                >
                                  {pt.shortDate}
                                </text>
                              )}
                            </g>
                          );
                        })}

                        {/* Dedicated Top-Level Tooltip Overlay (Never Obscured by Subsequent Circles) */}
                        {highlightedPoint && (() => {
                          const tipW = 144;
                          const tipH = 54;
                          const tipX = Math.max(4, Math.min(chartW - tipW - 4, highlightedPoint.x - tipW / 2));
                          const tipY = highlightedPoint.y - tipH - 10 >= 2 ? highlightedPoint.y - tipH - 10 : highlightedPoint.y + 12;

                          return (
                            <g className="pointer-events-none transition-all duration-150">
                              <rect
                                x={tipX}
                                y={tipY}
                                width={tipW}
                                height={tipH}
                                rx="10"
                                fill="#ffffff"
                                stroke="#cbd5e1"
                                strokeWidth="1.2"
                                filter="url(#shadowP1)"
                              />
                              <text
                                x={tipX + 14}
                                y={tipY + 19}
                                textAnchor="start"
                                fontSize="12"
                                fontWeight="600"
                                fill="#64748b"
                                className="select-none"
                              >
                                {highlightedPoint.date}
                              </text>
                              <text
                                x={tipX + 14}
                                y={tipY + 42}
                                textAnchor="start"
                                fontSize="17"
                                fontWeight="800"
                                fill="#0f172a"
                                className="select-none tabular-nums"
                              >
                                RM{(highlightedPoint.totalSen / 100).toFixed(2)}
                              </text>
                            </g>
                          );
                        })()}
                  </svg>


                </div>

                {/* Divided Ledger */}
                <div className="divide-y divide-surface-border border-t border-surface-border">
                  {trend.map((row) => (
                    <Link
                      key={row.date}
                      href={`/?date=${row.date}`}
                      className="min-h-[52px] py-3 flex items-center justify-between text-sm hover:bg-surface-subtle -mx-2 px-2.5 rounded-lg transition-colors group"
                    >
                      <span className="font-medium text-ink-primary text-sm tabular-nums">
                        {row.date}
                      </span>
                      <div className="flex items-center gap-2.5">
                        <div className="text-right">
                          <span className="text-xs text-ink-muted mr-1.5">
                            {t.sheetRevCol}:
                          </span>
                          <span className="font-bold text-ink-primary text-sm tabular-nums">
                            {formatMyr(BigInt(row.totalSen))}
                          </span>
                        </div>
                        <svg
                          className="w-4 h-4 text-ink-muted group-hover:text-ink-primary transition-colors shrink-0"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
