"use client";

// Loading screens shaped like each loaded page, so switching dates or months
// doesn't shift the page. They copy the page's boxes and spacing; text shows as
// pulsing bars the size of the text it stands for. scripts/cloud-flows/skeletons.mjs
// checks the boxes line up with the loaded pages.
import React from "react";
import { useI18n } from "@/lib/i18n";

const bar = "bg-surface-subtle animate-pulse";
const section = "bg-white border border-surface-border rounded-xl shadow-xs";
const card = `${section} p-3`;
const navButton = `w-11 h-11 shrink-0 rounded-lg sm:w-28 ${bar}`;
const divider = (
  <div className="pt-2 pb-0.5">
    <hr className="border-t border-surface-border" />
  </div>
);

function SectionHeader() {
  return (
    <div className="h-6 flex items-center justify-between px-0.5">
      <div className={`h-4 w-24 rounded-md ${bar}`} />
      <div className={`h-4 w-36 rounded-md ${bar}`} />
    </div>
  );
}

// Text-sized bar: the text itself, invisible, so it wraps and sizes like the real one.
function Ghost({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="text-transparent select-none rounded-md bg-surface-subtle animate-pulse box-decoration-clone">
      {children}
    </span>
  );
}
const amount = "RM0,000.00";

/** Empty Daily Sheet (no cost lines). */
export function DailySheetSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className={card}>
        <div className="flex items-center justify-between">
          <div className={navButton} />
          <div className="py-1 flex flex-col items-center">
            <div className="h-6 flex items-center"><div className={`h-4 w-24 rounded-md ${bar}`} /></div>
            <div className="h-[19.5px] flex items-center"><div className={`h-3 w-28 rounded-md ${bar}`} /></div>
          </div>
          <div className={navButton} />
        </div>
      </div>

      <div className="space-y-2">
        <SectionHeader />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {[0, 1].map((i) => (
            <div key={i} className={card}>
              <div className="h-5 mb-1.5 flex items-center"><div className={`h-3.5 w-28 rounded-md ${bar}`} /></div>
              <div className={`h-12 rounded-lg ${bar}`} />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        {divider}
        <SectionHeader />
        <div className={`h-[60px] rounded-xl ${bar}`} />
        {divider}
      </div>

      <div className="sticky bottom-16 z-30">
        <div className="bg-white/95 border border-surface-border rounded-xl p-3 shadow-sm flex items-center justify-between gap-3">
          <div className="space-y-1.5">
            <div className={`h-3 w-24 rounded-md ${bar}`} />
            <div className={`h-5 w-20 rounded-md ${bar}`} />
          </div>
          <div className={`h-12 w-28 rounded-lg ${bar}`} />
        </div>
      </div>
    </div>
  );
}

/** Page title and month picker, shared by the month pages. */
function MonthHeader({ title }: { title: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-xl font-bold text-ink-primary tracking-tight">{title}</h1>
      {/* Same box as MonthSelectorDropdown's button. */}
      <div className="inline-block">
        <div className="h-10 pl-3 pr-2.5 rounded-xl border border-surface-border bg-white flex items-center gap-2 shadow-xs">
          <span className="font-bold text-sm tracking-tight"><Ghost>2026-10</Ghost></span>
          <span className={`grid text-xs font-semibold px-2 py-0.5 rounded-full border border-transparent shrink-0 text-transparent ${bar}`}>
            {[t.openStatus, t.closedStatus, t.reopenedStatus].map((label) => (
              <span key={label} className="col-start-1 row-start-1">{label}</span>
            ))}
          </span>
          <span className="w-4 h-4 shrink-0" />
        </div>
      </div>
    </div>
  );
}

/** Label over an amount, as in the summary strips. */
function Stat({ label, className, amountClass }: { label: string; className: string; amountClass: string }) {
  return (
    <div className={`${className} text-center sm:text-left`}>
      <div className="text-sm font-medium mb-0.5"><Ghost>{label}</Ghost></div>
      <div className={`${amountClass} font-bold tabular-nums`}><Ghost>{amount}</Ghost></div>
    </div>
  );
}

function TotalRow({ label, colSpan, amountClass }: { label: string; colSpan: string; amountClass: string }) {
  return (
    <div className={`${colSpan} p-3.5 sm:px-5 flex items-center justify-between`}>
      <div className="text-base font-bold"><Ghost>{label}</Ghost></div>
      <div className={`${amountClass} font-extrabold tracking-tight tabular-nums`}><Ghost>{amount}</Ghost></div>
    </div>
  );
}

/** Label on the left, amount on the right, as in the ledger rows. */
function LedgerRow({ label, className = "", dot, amountClass = "" }: { label: string; className?: string; dot?: string; amountClass?: string }) {
  return (
    <div className={`flex items-center justify-between text-sm ${className}`}>
      <div className="flex items-center gap-2">
        {dot && <span className={`${dot} rounded-full shrink-0 ${bar}`} />}
        <span className="font-medium"><Ghost>{label}</Ghost></span>
      </div>
      <span className={`${amountClass} font-bold tabular-nums`}><Ghost>{amount}</Ghost></span>
    </div>
  );
}

/** Overview with two cost categories and three days of entries. */
export function DashboardSkeleton() {
  const { t } = useI18n();
  return (
    <div className="space-y-4" aria-busy="true">
      <MonthHeader title={t.overviewTitle} />

      <section className={`${section} overflow-hidden`}>
        <div className="px-5 py-4 sm:px-6 sm:py-5">
          <div className="text-base font-bold"><Ghost>{t.netProfit}</Ghost></div>
          <div className="mt-1 text-3xl sm:text-4xl font-extrabold tracking-tight tabular-nums"><Ghost>{amount}</Ghost></div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-surface-border border-t border-surface-border">
          {[t.totalRevenue, t.costsTitle, t.operatingExpenses].map((label) => (
            <div key={label} className="px-3.5 py-3 sm:px-5 sm:py-3.5">
              <span className="block text-sm font-bold truncate text-transparent"><Ghost>{label}</Ghost></span>
              <span className="mt-1 block text-sm sm:text-xl font-bold tabular-nums"><Ghost>{amount}</Ghost></span>
            </div>
          ))}
        </div>
      </section>

      <section className={`${section} p-4 space-y-3`}>
        <h2 className="text-base font-bold"><Ghost>{t.revenueSplit}</Ghost></h2>
        <div className="space-y-3 pt-1">
          <div className={`w-full h-8 rounded-full ${bar}`} />
          <div className="divide-y divide-surface-border border-t border-surface-border pt-1">
            <LedgerRow label={t.cashRevenue} className="py-2" dot="w-2.5 h-2.5" />
            <LedgerRow label={t.tngRevenue} className="py-2" dot="w-2.5 h-2.5" />
          </div>
        </div>
      </section>

      <section className={`${section} p-4 space-y-4`}>
        <h2 className="text-base font-bold"><Ghost>{t.costDistribution}</Ghost></h2>
        <div className="flex flex-col md:flex-row items-center gap-5 pt-1">
          <div className="shrink-0 p-1">
            <div className="w-48 h-48 sm:w-52 sm:h-52 rounded-full border-[40px] border-surface-subtle animate-pulse" />
          </div>
          <div className="flex-1 w-full divide-y divide-surface-border border-t md:border-t-0 md:border-l border-surface-border md:pl-5">
            <LedgerRow label={t.costsTitle} className="py-2.5" dot="w-3 h-3" />
            <LedgerRow label={t.costsTitle} className="py-2.5" dot="w-3 h-3" />
          </div>
        </div>
      </section>

      <section className={`${section} p-4 space-y-3`}>
        <div className={`h-[46px] rounded-lg ${bar}`} />
        <div className="flex items-center justify-between pb-1">
          <h2 className="text-base font-bold"><Ghost>{t.dailyTrend}</Ghost></h2>
        </div>
        <div className="space-y-4">
          <div className="w-full overflow-x-auto pb-2">
            <div className={`w-full min-w-[340px] aspect-[3/1] rounded-md ${bar}`} />
          </div>
          <div className="divide-y divide-surface-border border-t border-surface-border">
            {[0, 1, 2].map((i) => (
              <LedgerRow key={i} label="2026-01-01" className="min-h-[52px] py-3" />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/** Expenses with two expense lines. */
export function ExpensesSkeleton() {
  const { t } = useI18n();
  return (
    <div className="space-y-4" aria-busy="true">
      <MonthHeader title={t.expensesTitle} />

      <section className={`${section} grid grid-cols-2 overflow-hidden`}>
        <Stat label={t.monthGrossProfit} className="p-3 border-b border-surface-border" amountClass="text-base sm:text-xl" />
        <Stat label={t.operatingExpenses} className="p-3 border-l border-b border-surface-border" amountClass="text-base sm:text-xl" />
        <TotalRow label={t.netProfit} colSpan="col-span-2" amountClass="text-2xl sm:text-3xl" />
      </section>

      <section className="space-y-2.5">
        {divider}
        <div className="flex items-center justify-between px-0.5 text-sm font-bold uppercase tracking-wider">
          <Ghost>{t.expensesTitle}</Ghost>
          <Ghost>{amount}</Ghost>
        </div>
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className={`${section} px-4 py-3 flex items-center justify-between gap-2`}>
              <span className="text-xs font-semibold"><Ghost>{t.operatingExpenses}</Ghost></span>
              <span className="h-9 flex items-center text-base font-bold tabular-nums"><Ghost>{amount}</Ghost></span>
            </div>
          ))}
        </div>
        <div className={`h-[60px] rounded-xl ${bar}`} />
      </section>
    </div>
  );
}

/** Month Close for a month that is still open. */
export function MonthCloseSkeleton() {
  const { t } = useI18n();
  const field = (label: string) => (
    <div>
      <div className="text-sm font-semibold mb-1.5"><Ghost>{label}</Ghost></div>
      <div className={`h-12 rounded-lg ${bar}`} />
    </div>
  );
  return (
    <div className="space-y-4" aria-busy="true">
      <MonthHeader title={t.closeTitle} />

      <section className={`${section} grid grid-cols-3 overflow-hidden`}>
        <Stat label={t.totalRevenue} className="p-3 border-b border-surface-border" amountClass="text-base sm:text-xl" />
        <Stat label={t.costsTitle} className="p-3 border-x border-b border-surface-border" amountClass="text-base sm:text-xl" />
        <Stat label={t.operatingExpenses} className="p-3 border-b border-surface-border" amountClass="text-base sm:text-xl" />
        <TotalRow label={t.expectedNet} colSpan="col-span-3" amountClass="text-2xl sm:text-3xl" />
      </section>

      <div className={`${section} p-4 space-y-3.5`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {field(t.cashOnHand)}
          {field(t.tngOnHand)}
        </div>
        <div className="p-3 rounded-lg bg-surface-subtle/40 border border-surface-border space-y-2">
          <LedgerRow label={t.actualTotal} amountClass="text-base" />
          <LedgerRow label={t.expectedNet} amountClass="text-base" />
          <div className="pt-2 border-t border-surface-border">
            <LedgerRow label={t.reconciliationDiff} amountClass="text-base" />
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold mb-1"><Ghost>{t.closeNote}</Ghost></div>
          <div className={`h-11 rounded-lg ${bar}`} />
        </div>
        <div className={`h-12 rounded-lg ${bar}`} />
      </div>
    </div>
  );
}
