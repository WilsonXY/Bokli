"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ActionIcon } from "./ActionIcon";
import { ChannelIcon } from "./ChannelIcon";
import { DashboardView, type SerializedMonthTile } from "./DashboardView";
import { MonthSelectorDropdown } from "./MonthSelectorDropdown";

const amount = "RM 0,000.00";
const value = "skeleton-value";
function MoneyField() {
  return <div className="skeleton-money-field" aria-hidden="true"><span data-money-prefix>RM</span></div>;
}
function useRequestedPeriod(param: "date" | "month") {
  const [period, setPeriod] = useState("");
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get(param) ?? "";
    if ((param === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/).test(requested)) setPeriod(requested);
  }, [param]);
  return period;
}
function LoadingBackLink() {
  const { t } = useI18n();
  const month = useRequestedPeriod("month");
  return <Link className="mobile-back-link" href={month ? `/dashboard?month=${month}` : "/dashboard"} prefetch={false}><span aria-hidden="true">‹</span>{t.navDashboard}</Link>;
}

export function DailySheetSkeleton() {
  const { t } = useI18n();
  const date = useRequestedPeriod("date");
  return <div className="daily-layout page-stack" aria-busy="true">
    <div className="page-heading sheet-page-heading"><div><h1>{t.sheetTitle}</h1><p className="page-description">{t.sheetHint}</p></div><span className="sheet-status" role="status"><span className="animate-spin"><ActionIcon name="refresh" size={18} /></span><span className="sr-only">{t.loadingShort}</span></span></div>
    <div className="sheet-date-bar"><div className="skeleton-date-body">
      <button disabled aria-label={t.prevDay} className="w-11 h-11 shrink-0 sm:w-auto sm:px-3.5 flex items-center justify-center gap-1.5"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 19-7-7 7-7" /></svg><span className="hidden sm:inline">{t.prevDay}</span></button>
      <div className="date-picker-group"><button disabled className="date-picker-trigger px-2 py-1 rounded-lg"><div className="date-trigger-label flex items-center justify-center gap-1.5 whitespace-nowrap"><ActionIcon name="calendar" size={20} /><span className="loading-period">{date || "——"}</span></div><p className="sheet-date-meta text-[13px]">{t.klTime}</p></button><span className="date-today-slot"><span className="skeleton-period-slot" aria-hidden="true" /></span></div>
      <button disabled aria-label={t.nextDay} className="w-11 h-11 shrink-0 sm:w-auto sm:px-3.5 flex items-center justify-center gap-1.5"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 5 7 7-7 7" /></svg><span className="hidden sm:inline">{t.nextDay}</span></button>
    </div></div>
    <section className="daily-revenue space-y-2"><div className="section-heading flex items-center justify-between px-0.5"><h2>{t.revenueTitle}</h2><span>{t.totalRevenue}{t.fieldColon} <span className={value} aria-hidden="true">{"RM 0.00"}</span></span></div>
      <div className="revenue-fields">{(["cash", "tng"] as const).map(channel => <div key={channel} className={`revenue-field ${channel}-revenue`}><div className="revenue-field-label flex items-center"><span className="revenue-channel-icon"><ChannelIcon channel={channel} /></span><label>{channel === "cash" ? t.cashRevenueShort : t.tngRevenueShort}</label></div><MoneyField /></div>)}</div>
    </section>
    <section className="daily-costs space-y-2.5"><div className="section-heading flex items-center justify-between"><h2>{t.costsTitle}</h2><span>{t.totalCosts}{t.fieldColon} <span className={value} aria-hidden="true">{"RM 0.00"}</span></span></div><button disabled className="add-cost-action skeleton-action w-full" aria-label={t.addCostLine}><ActionIcon name="add" size={24} /></button></section>
    <div className="sheet-save-bar"><div className="sheet-save-panel"><div className="sheet-profit-summary"><div>{t.grossProfit}</div><div className={value} aria-hidden="true">{"RM 0.00"}</div></div><div className="sheet-actions"><button disabled className="sheet-save-action skeleton-action" aria-label={t.saveSheet}><ActionIcon name="save" /><span>{t.saveShort}</span></button></div></div></div>
  </div>;
}

function MonthHeader({ title, hint }: { title: string; hint: string }) {
  const { t } = useI18n();
  const month = useRequestedPeriod("month");
  return <div className="page-heading"><div><h1>{title}</h1><p className="page-description">{hint}</p></div><div className="skeleton-picker"><MonthSelectorDropdown loadingLabel={t.loadingShort} currentMonth={month} options={[]} onSelect={() => {}} /></div></div>;
}

// Sizing fixtures remain inert and their changing values are masked.
const tile: SerializedMonthTile = { month: "2026-10", revenueSen: 30000, dailyCostSen: 10000, grossSen: 20000, operatingSen: 5000, netSen: 15000, status: "open" };
export function DashboardSkeleton() {
  const month = useRequestedPeriod("month");
  return <div className="loading-layout" aria-busy="true" inert><DashboardView loading tiles={[tile]} activeMonth={month} activeTile={tile}
    trend={[3, 10, 17].map(day => ({ date: `2026-10-${String(day).padStart(2,"0")}`, cashSen: 20000, tngSen: 10000, totalSen: 30000, costSen: 10000 }))}
    split={{ cashSen: 20000, tngSen: 10000, totalSen: 30000 }}
    costByCategory={{ restock: 5000, gas: 5000, transport: 0, "wages-daily": 0, maintenance: 0, other: 0 }} /></div>;
}

export function ExpensesSkeleton() {
  const { t } = useI18n();
  return <div className="expenses-layout page-stack" aria-busy="true">
    <MonthHeader title={t.expensesTitle} hint={t.expensesHint} />
    <section className="expense-month-summary"><div className="expense-month-total"><span>{t.operatingExpenses}</span><strong className={value} aria-hidden="true">{amount}</strong></div><div className="expense-month-context"><div><span>{t.monthGrossProfit}</span><strong className={value} aria-hidden="true">{amount}</strong></div><div><span>{t.netProfit}</span><strong className={value} aria-hidden="true">{amount}</strong></div></div></section>
    <section className="operating-expenses space-y-2.5"><div className="expense-records-heading expense-toolbar"><h2 className="sr-only">{t.savedExpensesTitle}</h2><button disabled className="expense-add-icon" aria-label={t.addExpense}><ActionIcon name="add" size={24} /></button><span className={`expense-list-total ${value}`} aria-hidden="true">{amount}</span></div><div className="space-y-2">{[0, 1].map(index => <div key={index} className="expense-record" aria-hidden="true"><div className="expense-record-summary"><span className={`expense-record-category ${value}`}>{index ? t.catUtilities : t.catRental}</span><span className={`expense-record-amount text-base ${value}`}>{amount}</span><span className="record-chevron" aria-hidden="true">⌄</span></div></div>)}</div></section>
  </div>;
}
export function MonthCloseSkeleton() {
  const { t } = useI18n();
  const field = (label: string) => <div><label className="block text-sm mb-1.5">{label}</label><MoneyField /></div>;
  return <div className="close-layout page-stack" aria-busy="true">
    <LoadingBackLink />
    <MonthHeader title={t.closeTitle} hint={t.closeHint} />
    <section className="close-expectation"><div className="close-expected-total"><span>{t.expectedNet}</span><strong className={value} aria-hidden="true">{amount}</strong></div><div className="close-calculation"><div className="skeleton-calculation-label">{t.viewCalculation}<span className="calculation-chevron" aria-hidden="true">⌄</span></div></div></section>
    <div className="reconciliation-form space-y-3.5">
      <p className="counts-hint">{t.zeroBalanceShort}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">{field(t.cashOnHand)}{field(t.tngOnHand)}</div>
      <div className="reconciliation-preview p-3 border space-y-2"><div className="flex items-center justify-between text-sm"><span>{t.actualTotal}</span><span className={`text-base ${value}`} aria-hidden="true">{amount}</span></div><div className="flex items-center justify-between text-sm"><span>{t.expectedNet}</span><span className={`text-base ${value}`} aria-hidden="true">{amount}</span></div><div className="reconciliation-result is-pending"><div className="reconciliation-result-line"><span>{t.reconciliationDiff}</span><strong className={value} aria-hidden="true">{t.awaitingCounts}</strong></div></div></div>
      <div><label className="block text-sm mb-1">{t.closeNote} <span className="optional-label">{t.optionalBadge}</span></label><div className="skeleton-close-note" /></div>
      <p className="sr-only">{t.enterBothToClose}</p>
      <button disabled className="skeleton-action w-full h-14" aria-label={t.btnPerformClose}><ActionIcon name="lock" /><span>{t.closeShort}</span></button>
    </div>
  </div>;
}
