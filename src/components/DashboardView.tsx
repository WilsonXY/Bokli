"use client";

import React from "react";
import Link from "next/link";
import { formatMyr } from "@/lib/money";
import { useI18n } from "@/lib/i18n";

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
  };
  costByCategory: SerializedCostByCategory;
}

export function DashboardView({
  tiles,
  activeMonth,
  activeTile,
  trend,
  split,
  costByCategory,
}: DashboardViewProps) {
  const { t } = useI18n();

  const totalRev = BigInt(split.totalSen);
  const cashPct =
    totalRev > 0n ? Math.round(Number((BigInt(split.cashSen) * 100n) / totalRev)) : 0;
  const tngPct = totalRev > 0n ? 100 - cashPct : 0;

  const totalCosts =
    costByCategory.restock +
    costByCategory.gas +
    costByCategory.transport +
    costByCategory["wages-daily"] +
    costByCategory.maintenance +
    costByCategory.other;

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

  return (
    <div className="space-y-4">
      {/* Title & Month Carousel */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold text-ink-primary tracking-tight">
            {t.overviewTitle}
          </h1>
          <span className="text-sm font-medium text-ink-muted">
            {t.currentViewing}: <span className="font-bold text-ink-primary text-base">{activeMonth}</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar">
          {tiles.length === 0 ? (
            <div className="text-xs text-ink-muted py-2">{t.noMonthsRecorded}</div>
          ) : (
            tiles.map((tile) => {
              const isActive = tile.month === activeMonth;
              return (
                <Link
                  key={tile.month}
                  href={`/dashboard?month=${tile.month}`}
                  className={`min-h-[44px] px-3.5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-broccoli/60 ${
                    isActive
                      ? "bg-brand-broccoli text-white shadow-xs"
                      : "bg-surface-subtle text-ink-secondary hover:text-ink-primary hover:bg-surface-border/60 border border-surface-border"
                  }`}
                >
                  <span>{tile.month}</span>
                  <span
                    className={`text-[13px] px-2 py-0.5 rounded font-semibold ${
                      isActive
                        ? "bg-white/20 text-white"
                        : tile.status === "closed"
                        ? "bg-status-closed-bg text-status-closed"
                        : "bg-surface-subtle text-ink-muted"
                    }`}
                  >
                    {statusLabel(tile.status)}
                  </span>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {/* KPI Cards Grid */}
      {activeTile && (
        <div className="bg-white border border-surface-border rounded-xl p-3.5 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <span className="text-sm font-bold text-ink-secondary uppercase tracking-wider">
              {t.monthSummary}
            </span>
            <span
              className={`text-[13px] font-bold px-2 py-0.5 rounded-md ${
                activeTile.status === "closed"
                  ? "bg-status-closed-bg text-status-closed"
                  : "bg-brand-broccoli-light text-brand-broccoli"
              }`}
            >
              {statusLabel(activeTile.status)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-2.5 rounded-lg bg-surface-canvas border border-surface-border">
              <span className="block text-[13px] text-ink-muted font-semibold mb-0.5">
                {t.totalRevenue}
              </span>
              <span className="text-xl font-bold text-ink-primary">
                {formatMyr(BigInt(activeTile.revenueSen))}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-surface-canvas border border-surface-border">
              <span className="block text-[13px] text-ink-muted font-semibold mb-0.5">
                {t.totalCosts}
              </span>
              <span className="text-xl font-bold text-finance-loss">
                {formatMyr(BigInt(activeTile.dailyCostSen))}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-surface-canvas border border-surface-border">
              <span className="block text-[13px] text-ink-muted font-semibold mb-0.5">
                {t.grossProfit}
              </span>
              <span
                className={`text-xl font-bold ${
                  activeTile.grossSen >= 0 ? "text-brand-broccoli" : "text-finance-loss"
                }`}
              >
                {formatMyr(BigInt(activeTile.grossSen))}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-surface-canvas border border-surface-border">
              <span className="block text-[13px] text-ink-muted font-semibold mb-0.5">
                {t.operatingExpenses}
              </span>
              <span className="text-xl font-bold text-ink-secondary">
                {formatMyr(BigInt(activeTile.operatingSen))}
              </span>
            </div>
          </div>

          {/* Net Profit Banner */}
          <div
            className={`p-3 rounded-lg border flex items-center justify-between ${
              activeTile.netSen >= 0
                ? "bg-finance-profit-light/40 border-finance-profit-border"
                : "bg-finance-loss-light border-finance-loss-border"
            }`}
          >
            <div className="text-base font-bold text-ink-primary">
              {t.netProfit}
            </div>
            <div
              className={`text-2xl font-black ${
                activeTile.netSen >= 0 ? "text-brand-broccoli" : "text-finance-loss"
              }`}
            >
              {formatMyr(BigInt(activeTile.netSen))}
            </div>
          </div>
        </div>
      )}

      {/* Revenue Split: Cash vs TnG */}
      <div className="bg-white border border-surface-border rounded-xl p-3.5 shadow-xs space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-secondary uppercase tracking-wider">
            {t.revenueSplit}
          </h2>
          <span className="text-base font-bold text-ink-primary">
            {formatMyr(BigInt(split.totalSen))}
          </span>
        </div>

        {split.totalSen === 0 ? (
          <div className="py-3 text-center text-xs text-ink-muted">
            {t.noRevenueData}
          </div>
        ) : (
          <div className="space-y-2">
            {/* Visual Ratio Bar */}
            <div className="w-full h-3 rounded-full bg-surface-subtle overflow-hidden flex">
              <div
                style={{ width: `${cashPct}%` }}
                className="bg-channel-cash h-full transition-all"
                title={`Cash: ${cashPct}%`}
              />
              <div
                style={{ width: `${tngPct}%` }}
                className="bg-channel-tng h-full transition-all"
                title={`TnG: ${tngPct}%`}
              />
            </div>

            {/* Split Legend & Values */}
            <div className="grid grid-cols-2 gap-2 pt-1 text-sm">
              <div className="flex items-center justify-between p-2 rounded-lg bg-surface-canvas border border-surface-border">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-channel-cash inline-block" />
                  <span className="font-semibold text-ink-secondary">{t.cashRevenue}</span>
                </div>
                <div className="text-right">
                  <span className="text-base font-bold text-ink-primary block">
                    {formatMyr(BigInt(split.cashSen))}
                  </span>
                  <span className="text-[13px] font-medium text-ink-muted">{cashPct}%</span>
                </div>
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-surface-canvas border border-surface-border">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-channel-tng inline-block" />
                  <span className="font-semibold text-ink-secondary">{t.tngRevenue}</span>
                </div>
                <div className="text-right">
                  <span className="text-base font-bold text-ink-primary block">
                    {formatMyr(BigInt(split.tngSen))}
                  </span>
                  <span className="text-[13px] font-medium text-ink-muted">{tngPct}%</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Cost Breakdown - Neutral Slate Bars (No Orange) */}
      <div className="bg-white border border-surface-border rounded-xl p-3.5 shadow-xs space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-secondary uppercase tracking-wider">
            {t.costDistribution}
          </h2>
          <span className="text-base font-bold text-finance-loss">
            {formatMyr(BigInt(totalCosts))}
          </span>
        </div>

        {totalCosts === 0 ? (
          <div className="py-3 text-center text-xs text-ink-muted">
            {t.noCostData}
          </div>
        ) : (
          <div className="space-y-2">
            {(Object.keys(categoryLabels) as Array<keyof SerializedCostByCategory>).map((cat) => {
              const amount = costByCategory[cat];
              if (amount === 0) return null;
              const pct = totalCosts > 0 ? Math.round((amount / totalCosts) * 100) : 0;

              return (
                <div key={cat} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-ink-secondary">
                      {categoryLabels[cat]}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-ink-muted">{pct}%</span>
                      <span className="text-sm font-bold text-ink-primary">
                        {formatMyr(BigInt(amount))}
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-surface-subtle overflow-hidden">
                    <div
                      style={{ width: `${pct}%` }}
                      className="h-full bg-slate-500 rounded-full"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Daily Trend List */}
      <div className="bg-white border border-surface-border rounded-xl p-3.5 shadow-xs space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-secondary uppercase tracking-wider">
            {t.dailyTrend}
          </h2>
          <span className="text-[13px] text-ink-muted">
            {trend.length} {t.dateCol}
          </span>
        </div>

        {trend.length === 0 ? (
          <div className="py-3 text-center text-xs text-ink-muted">
            {t.noDailyEntries}
          </div>
        ) : (
          <div className="divide-y divide-surface-border">
            {trend.map((row) => (
              <Link
                key={row.date}
                href={`/?date=${row.date}`}
                className="py-2.5 flex items-center justify-between text-sm hover:bg-surface-subtle -mx-2 px-2 rounded transition-colors"
              >
                <span className="font-mono font-semibold text-ink-primary text-sm">
                  {row.date}
                </span>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-[13px] text-ink-muted mr-1">{t.sheetRevCol}:</span>
                    <span className="font-bold text-ink-primary text-base">
                      {formatMyr(BigInt(row.totalSen))}
                    </span>
                  </div>
                  <span className="text-ink-muted">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
