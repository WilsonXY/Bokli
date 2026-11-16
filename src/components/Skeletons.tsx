"use client";

// Loading screens shaped like each loaded page, so switching dates or months
// doesn't shift the page. Every card, button and list row is a plain grey
// block the same size as on the loaded page; headings and dividers keep their
// space but don't show. Blocks keep the page's own content, hidden, so they
// size and wrap like the real thing in both languages.
// scripts/cloud-flows/skeletons.mjs checks the boxes line up with the loaded pages.
import React from "react";
import { useI18n } from "@/lib/i18n";

/** A grey block; its children only give it its size. */
const block = "rounded-xl bg-surface-subtle animate-pulse border border-transparent [&>*]:invisible";
const amount = "RM0,000.00";
const divider = (
  <div className="pt-2 pb-0.5 invisible">
    <hr />
  </div>
);
/** Heading row: keeps its space, shows nothing. */
const heading = (className: string) => <div className={`invisible ${className}`}>&nbsp;</div>;

/** Empty Daily Sheet (no cost lines). */
export function DailySheetSkeleton() {
  const { t } = useI18n();
  return (
    <div className="daily-layout page-stack" aria-busy="true">
      <div className="page-heading"><div><h1 className="invisible">{t.sheetTitle}</h1><p className="page-description invisible">{t.sheetHint}</p></div><span className="sheet-status invisible"><span />{t.newSheetStatus}</span></div>
      <div className={`${block} p-3`}>
        <div className="h-[51.5px]" />
      </div>

      <section aria-label={t.revenueTitle} className="daily-revenue space-y-2">
        {heading("h-6")}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {[0, 1].map((i) => (
            <div key={i} className={`${block} p-3`}>
              <div className="skeleton-revenue-body" />
            </div>
          ))}
        </div>
      </section>

      <section aria-label={t.costsTitle} className="daily-costs space-y-2.5">
        {divider}
        {heading("h-6")}
        <div className={`${block} h-[60px]`} />
        {divider}
      </section>

      <div className="sheet-save-bar sticky bottom-16 z-30">
        <div className={`${block} p-3`}>
          <div className="h-12" />
        </div>
      </div>
    </div>
  );
}

/** Page title and month picker, shared by the month pages. */
function MonthHeader({ title, hint }: { title: string; hint: string }) {
  const { t } = useI18n();
  return (
    <div className="page-heading">
      <div><h1>{title}</h1><p className="page-description">{hint}</p></div>
      {/* Same content as MonthSelectorDropdown's button, so it is as wide. */}
      <div className="inline-block">
        <div className={`${block} h-11 pl-3 pr-2.5 flex items-center gap-2`} aria-hidden="true">
          <span className="font-bold text-sm tracking-tight">2026-10</span>
          <span className="grid text-xs font-semibold px-2 py-0.5 border shrink-0">
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
    <div className={className}>
      <div className="text-sm font-medium mb-0.5">{label}</div>
      <div className={`${amountClass} font-bold`}>{amount}</div>
    </div>
  );
}

function TotalRow({ label, colSpan, amountClass }: { label: string; colSpan: string; amountClass: string }) {
  return (
    <div className={`${colSpan} p-3.5 sm:px-5 flex items-center justify-between`}>
      <div className="text-base font-bold">{label}</div>
      <div className={`${amountClass} font-extrabold tracking-tight`}>{amount}</div>
    </div>
  );
}

/** One line of text at the row's size, as in the ledger rows. */
function Row({ className = "", textClass = "" }: { className?: string; textClass?: string }) {
  return <div className={`flex text-sm ${className}`}><span className={textClass}>{amount}</span></div>;
}

/** Overview with two cost categories and three days of entries. */
export function DashboardSkeleton() {
  const { t } = useI18n();
  return (
    <div className="dashboard-layout page-stack" aria-busy="true">
      <MonthHeader title={t.overviewTitle} hint={t.overviewHint} />

      <section className={`${block} overview-summary`}>
        <div className="px-5 py-4 sm:px-6 sm:py-5">
          <div className="text-base font-bold">{t.netProfit}</div>
          <div className="mt-1 text-3xl sm:text-4xl font-extrabold">{amount}</div>
        </div>
        <div className="grid grid-cols-3 border-t">
          {[t.totalRevenue, t.costsTitle, t.operatingExpenses].map(label => <div key={label} className="px-3.5 py-3 sm:px-5 sm:py-3.5">
            <span className="block text-sm font-bold">{label}</span>
            <span className="mt-1 block text-sm sm:text-xl font-bold">{amount}</span>
          </div>)}
        </div>
      </section>

      <section className={`${block} overview-split p-4 space-y-3`}>
        <h2 className="text-base font-bold">{t.revenueSplit}</h2>
        <div className="space-y-3 pt-1">
          <div className="h-8" />
          <div className="divide-y border-t pt-1">
            <Row className="py-2" />
            <Row className="py-2" />
          </div>
        </div>
      </section>

      <section className={`${block} overview-costs p-4 space-y-4`}>
        <h2 className="text-base font-bold">{t.costDistribution}</h2>
        <div className="flex flex-col md:flex-row items-center gap-5 pt-1">
          <div className="shrink-0 p-1">
            <div className="w-48 h-48 sm:w-52 sm:h-52" />
          </div>
          <div className="flex-1 w-full divide-y border-t md:border-t-0">
            <Row className="py-2.5" />
            <Row className="py-2.5" />
          </div>
        </div>
      </section>

      <section className={`${block} overview-trend p-4 space-y-3`}>
        <div className="h-[46px]" />
        <div className="pb-1">
          <h2 className="text-base font-bold">{t.dailyTrend}</h2>
        </div>
        <div className="space-y-4">
          <div className="w-full overflow-x-auto pb-2">
            <div className="w-full min-w-[340px] aspect-[3/1] max-h-[300px]" />
          </div>
          <div className="divide-y border-t">
            {[0, 1, 2].map((i) => (
              <Row key={i} className="min-h-[52px] py-3" />
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
    <div className="expenses-layout page-stack" aria-busy="true">
      <MonthHeader title={t.expensesTitle} hint={t.expensesHint} />

      <section className={`${block} grid grid-cols-2`}>
        <Stat label={t.monthGrossProfit} className="p-3 border-b" amountClass="text-base sm:text-xl" />
        <Stat label={t.operatingExpenses} className="p-3 border-l border-b" amountClass="text-base sm:text-xl" />
        <TotalRow label={t.netProfit} colSpan="col-span-2" amountClass="text-2xl sm:text-3xl" />
      </section>

      <section className="space-y-2.5">
        {divider}
        {heading("h-5")}
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className={`${block} px-4 py-3`}>
              <div className="h-9" />
            </div>
          ))}
        </div>
        <div className={`${block} h-[60px]`} />
      </section>
    </div>
  );
}

/** Month Close for a month that is still open. */
export function MonthCloseSkeleton() {
  const { t } = useI18n();
  const field = (label: string) => (
    <div>
      <div className="text-sm font-semibold mb-1.5">{label}</div>
      <div className="h-12" />
    </div>
  );
  return (
    <div className="close-layout page-stack" aria-busy="true">
      <MonthHeader title={t.closeTitle} hint={t.closeHint} />

      <section className={`${block} grid grid-cols-3`}>
        <Stat label={t.totalRevenue} className="p-3 border-b" amountClass="text-base sm:text-xl" />
        <Stat label={t.costsTitle} className="p-3 border-x border-b" amountClass="text-base sm:text-xl" />
        <Stat label={t.operatingExpenses} className="p-3 border-b" amountClass="text-base sm:text-xl" />
        <TotalRow label={t.expectedNet} colSpan="col-span-3" amountClass="text-2xl sm:text-3xl" />
      </section>

      <div className={`${block} p-4 space-y-3.5`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {field(t.cashOnHand)}
          {field(t.tngOnHand)}
        </div>
        <div className="p-3 border space-y-2">
          <Row textClass="text-base" />
          <Row textClass="text-base" />
          <div className="pt-2 border-t">
            <Row textClass="text-base" />
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold mb-1">{t.closeNote}</div>
          <div className="h-11" />
        </div>
        <div className="h-12" />
      </div>
    </div>
  );
}
