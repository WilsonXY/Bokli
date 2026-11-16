"use client";

import Link from "next/link";
import React from "react";
import { useI18n } from "@/lib/i18n";
import { DashboardView, type SerializedMonthTile } from "./DashboardView";
import { MonthSelectorDropdown } from "./MonthSelectorDropdown";

const block = "skeleton-block bg-surface-subtle [&>*]:invisible animate-pulse";
const amount = "RM 0,000.00";

export function DailySheetSkeleton() {
  const { t } = useI18n();
  return <div className="daily-layout page-stack" aria-busy="true" inert>
    <div className="page-heading sheet-page-heading"><div><h1 className="invisible">{t.sheetTitle}</h1><p className="page-description invisible">{t.sheetHint}</p></div><span className="sheet-status invisible"><span />{t.newSheetStatus}</span></div>
    <div className={`sheet-date-bar ${block}`}><div className="skeleton-date-body" /></div>
    <section className="daily-revenue space-y-2"><div className="section-heading h-7 invisible" />
      <div className="revenue-fields">{[0, 1].map(index => <div key={index} className={`revenue-field ${index ? "tng-revenue" : "cash-revenue"} ${block}`}><div className="revenue-field-label flex items-center"><label>{index ? t.tngRevenue : t.cashRevenue}</label></div><div className="revenue-field-control"><div className="revenue-input" /></div></div>)}</div>
    </section>
    <section className="daily-costs space-y-2.5"><div className="section-heading h-7 invisible" /><div className={`add-cost-action ${block}`} /></section>
    <div className="sheet-save-bar"><div className={`sheet-save-panel ${block}`}><div className="sheet-profit-summary"><div>{t.grossProfit}</div><div>{amount}</div></div><div className="sheet-actions"><div className="sheet-save-action" /></div></div></div>
  </div>;
}

function MonthHeader({ title, hint }: { title: string; hint: string }) {
  return <div className="page-heading"><div><h1>{title}</h1><p className="page-description">{hint}</p></div><div className="skeleton-picker"><MonthSelectorDropdown currentMonth="2026-10" options={[]} onSelect={() => {}} /></div></div>;
}

const tile: SerializedMonthTile = { month: "2026-10", revenueSen: 30000, dailyCostSen: 10000, grossSen: 20000, operatingSen: 5000, netSen: 15000, status: "open" };
export function DashboardSkeleton() {
  return <div className="loading-layout" aria-busy="true" inert><DashboardView tiles={[tile]} activeMonth="2026-10" activeTile={tile}
    trend={[3, 10, 17].map(day => ({ date: `2026-10-${String(day).padStart(2,"0")}`, cashSen: 20000, tngSen: 10000, totalSen: 30000, costSen: 10000 }))}
    split={{ cashSen: 20000, tngSen: 10000, totalSen: 30000 }}
    costByCategory={{ restock: 5000, gas: 5000, transport: 0, "wages-daily": 0, maintenance: 0, other: 0 }} /></div>;
}

export function ExpensesSkeleton() {
  const { t } = useI18n();
  return <div className="expenses-layout page-stack" aria-busy="true" inert>
    <MonthHeader title={t.expensesTitle} hint={t.expensesHint} />
    <section className={`expense-month-summary ${block}`}><div className="expense-month-total"><span>{t.operatingExpenses}</span><strong>{amount}</strong></div><div className="expense-month-context"><div><span>{t.monthGrossProfit}</span><strong>{amount}</strong></div><div><span>{t.netProfit}</span><strong>{amount}</strong></div></div></section>
    <section className="operating-expenses space-y-2.5"><div className={`add-expense-action ${block}`} /><div className="section-heading flex items-center"><h2 className="invisible">{t.savedExpensesTitle}</h2></div><div className="space-y-2">{[0, 1].map(index => <div key={index} className={`expense-record ${block}`}><div className="expense-record-heading"><span className="expense-record-category">{index ? t.catUtilities : t.catRental}</span><span className="text-base">{amount}</span></div><div className="expense-record-actions"><span className="record-delete">{t.delete}</span></div></div>)}</div></section>
  </div>;
}
export function MonthCloseSkeleton() {
  const { t } = useI18n();
  const field = (label: string) => <div><label className="block text-sm mb-1.5">{label}</label><div className="skeleton-count-field" /></div>;
  return <div className="close-layout page-stack" aria-busy="true" inert>
    <Link className="mobile-back-link invisible" href="/dashboard"><span aria-hidden="true">‹</span>{t.navDashboard}</Link>
    <MonthHeader title={t.closeTitle} hint={t.closeHint} />
    <section className={`close-expectation ${block}`}><div className="close-expected-total"><span>{t.expectedNet}</span><strong>{amount}</strong></div><details className="close-calculation"><summary>{t.viewCalculation}<span>＋</span></summary></details></section>
    <div className={`reconciliation-form space-y-3.5 ${block}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">{field(t.cashOnHand)}{field(t.tngOnHand)}</div>
      <div className="reconciliation-preview p-3 border space-y-2"><div className="flex items-center justify-between text-sm"><span>{t.actualTotal}{t.fieldColon}</span><span className="text-base">{amount}</span></div><div className="flex items-center justify-between text-sm"><span>{t.expectedNet}{t.fieldColon}</span><span className="text-base">{amount}</span></div><div className="reconciliation-result is-pending"><div className="reconciliation-result-line"><span>{t.reconciliationDiff}</span><strong>{t.awaitingCounts}</strong></div></div></div>
      <div><label className="block text-sm mb-1">{t.closeNote}</label><div className="skeleton-close-note" /></div>
      <p className="counts-hint">{t.countsHint}</p><div className="h-14" />
    </div>
  </div>;
}
