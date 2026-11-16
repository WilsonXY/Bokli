"use client";

import React from "react";
import { useI18n } from "@/lib/i18n";
import { DashboardView, type SerializedMonthTile } from "./DashboardView";
import { MonthSelectorDropdown } from "./MonthSelectorDropdown";

// Children are sizing material only. Each visible loading surface is plain
// grey, inert, and shaped with the same classes as its loaded counterpart.
const block = "skeleton-block rounded-xl bg-surface-subtle border border-transparent [&>*]:invisible animate-pulse";
const amount = "RM0,000.00";

export function DailySheetSkeleton() {
  const { t } = useI18n();
  return <div className="daily-layout page-stack" aria-busy="true" inert>
    <div className="page-heading sheet-page-heading"><div><h1 className="invisible">{t.sheetTitle}</h1><p className="page-description invisible">{t.sheetHint}</p></div><span className="sheet-status invisible"><span />{t.newSheetStatus}</span></div>
    <div className={`sheet-date-bar ${block}`}><div className="skeleton-date-body" /></div>
    <section className="daily-revenue space-y-2"><div className="section-heading h-6 invisible" />
      <div className="revenue-fields grid grid-cols-1 sm:grid-cols-2 gap-2.5">{[0, 1].map(index => <div key={index} className={`revenue-field ${block}`}><div><div className="flex items-center gap-1.5 mb-1.5"><span className="w-2 h-2" /><label className="text-sm">{index === 0 ? t.cashRevenue : t.tngRevenue}</label></div><div className="revenue-input" /></div></div>)}</div>
    </section>
    <section className="daily-costs space-y-2.5"><div className="section-heading h-6 invisible" /><div className={`${block} h-[60px]`} /></section>
    <div className="sheet-save-bar"><div className={`sheet-save-panel ${block}`}><div className="h-12" /></div></div>
  </div>;
}

function MonthHeader({ title, hint }: { title: string; hint: string }) {
  return <div className="page-heading"><div><h1>{title}</h1><p className="page-description">{hint}</p></div><div className="skeleton-picker"><MonthSelectorDropdown currentMonth="2026-10" options={[]} onSelect={() => {}} /></div></div>;
}

// Overview is presentational: reusing it keeps its loading composition in sync
// with the real layout. All sizing values below are hidden by loading-layout.
const tile: SerializedMonthTile = { month: "2026-10", revenueSen: 30000, dailyCostSen: 10000, grossSen: 20000, operatingSen: 5000, netSen: 15000, status: "open" };
export function DashboardSkeleton() {
  return <div className="loading-layout" aria-busy="true" inert><DashboardView tiles={[tile]} activeMonth="2026-10" activeTile={tile}
    trend={[{ date: "2026-10-03", cashSen: 20000, tngSen: 10000, totalSen: 30000, costSen: 10000 }]}
    split={{ cashSen: 20000, tngSen: 10000, totalSen: 30000 }}
    costByCategory={{ restock: 5000, gas: 5000, transport: 0, "wages-daily": 0, maintenance: 0, other: 0 }} /></div>;
}

function Stat({ label, className = "" }: { label: string; className?: string }) {
  return <div className={`financial-stat p-3 text-center sm:text-left border-b border-surface-border ${className}`}><div className="financial-stat-label text-sm font-medium mb-0.5">{label}</div><div className="financial-value text-base sm:text-xl">{amount}</div></div>;
}
function Total({ label, columns }: { label: string; columns: string }) {
  return <div className={`financial-total ${columns} p-3.5 sm:px-5 flex items-center justify-between`}><div className="text-base">{label}</div><div className="financial-value text-2xl sm:text-3xl">{amount}</div></div>;
}
export function ExpensesSkeleton() {
  const { t } = useI18n();
  return <div className="expenses-layout page-stack" aria-busy="true" inert>
    <MonthHeader title={t.expensesTitle} hint={t.expensesHint} />
    <section className={`financial-snapshot grid grid-cols-2 ${block}`}><Stat label={t.monthGrossProfit} /><Stat label={t.operatingExpenses} className="border-l" /><Total label={t.netProfit} columns="col-span-2" /></section>
    <section className="operating-expenses space-y-2.5"><div className="section-heading h-6 invisible" /><div className="space-y-2">{[0, 1].map(index => <div key={index} className="expense-record bg-surface-subtle [&>*]:invisible animate-pulse"><div className="expense-record-heading"><span className="expense-record-category">{index === 0 ? t.catRental : t.catUtilities}</span><span className="text-base">{amount}</span></div><div className="expense-record-actions"><span className="record-delete">{t.delete}</span></div></div>)}</div><div className={`${block} h-[60px]`} /></section>
  </div>;
}
export function MonthCloseSkeleton() {
  const { t } = useI18n();
  const field = (label: string) => <div><label className="block text-sm mb-1.5">{label}</label><div className="h-12" /></div>;
  return <div className="close-layout page-stack" aria-busy="true" inert>
    <MonthHeader title={t.closeTitle} hint={t.closeHint} />
    <section className={`financial-snapshot grid grid-cols-3 ${block}`}><Stat label={t.totalRevenue} /><Stat label={t.costsTitle} className="border-x" /><Stat label={t.operatingExpenses} /><Total label={t.expectedNet} columns="col-span-3" /></section>
    <div className={`${block} p-4 space-y-3.5`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">{field(t.cashOnHand)}{field(t.tngOnHand)}</div>
      <div className="p-3 border space-y-2"><div className="flex text-base">{amount}</div><div className="flex text-base">{amount}</div><div className="pt-2 border-t text-base">{amount}</div></div>
      <div><label className="block text-sm mb-1">{t.closeNote}</label><div className="skeleton-close-note h-11" /></div>
      <p className="counts-hint">{t.countsHint}</p>
      <div className="h-12" />
    </div>
  </div>;
}
