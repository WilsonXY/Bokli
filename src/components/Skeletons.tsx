"use client";

import React from "react";
import { useI18n } from "@/lib/i18n";

const bar = "rounded-lg bg-surface-subtle animate-pulse";
const card = "bg-surface border border-surface-border rounded-2xl p-5 sm:p-6 shadow-card";

/**
 * Same-size stand-in for the MonthSelectorDropdown trigger: its real (hidden)
 * contents give it the real width in either language, so the header wraps
 * exactly like the loaded page. "0000-00" has the width of any month
 * (tabular digits), and the three status labels stack like the real badge.
 */
function MonthPickerBar() {
  const { t } = useI18n();
  return (
    <div aria-hidden="true" className={`${bar} h-12 lg:h-11 px-2.5 sm:px-3 rounded-xl border border-transparent flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 self-start sm:self-auto`}>
      <span className="invisible hidden min-[360px]:block w-4 h-4 shrink-0" />
      <span className="invisible font-semibold text-sm tracking-tight num-tabular">0000-00</span>
      <span className="invisible grid text-xs font-semibold px-2 py-0.5 border">
        {[t.openStatus, t.closedStatus, t.reopenedStatus].map((label) => (
          <span key={label} className="col-start-1 row-start-1">{label}</span>
        ))}
      </span>
      <span className="invisible w-4 h-4 shrink-0" />
    </div>
  );
}

// Matches the month pages' header: 32px title over (phones) or beside the month picker.
function HeaderBar() {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className={`${bar} h-8 w-44`} />
      <MonthPickerBar />
    </div>
  );
}

/**
 * Matches DailySheetForm box for box (scripts/cloud-flows/skeletons.mjs checks
 * it at 390px and 1280px): the same root spacing, a 36px title row over a 54px (58px at sm-md)
 * date toolbar, then Revenue + Daily Costs (empty day) and the Save card, with
 * the same 1px sticky sentinel below on phones.
 */
export function DailySheetSkeleton() {
  return (
    <div className="space-y-3 sm:space-y-5" aria-busy="true">
      <div className="space-y-2.5 sm:space-y-3">
        <div className="flex flex-col gap-2.5 sm:gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center min-h-9">
            <div className={`${bar} h-8 w-36`} />
          </div>
          <div className={`${bar} h-[54px] sm:h-[58px] lg:h-[54px] w-full md:w-[277px] rounded-xl`} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[auto_1fr] gap-3 sm:gap-5 items-start">
        <div className="lg:col-span-7 lg:row-span-2 space-y-3 sm:space-y-5">
          <div className={`${card} h-[120px] sm:h-[182px] space-y-4 overflow-hidden`}>
            <div className="flex items-center justify-between">
              <div className={`${bar} h-5 w-24`} />
              <div className={`${bar} h-5 w-28`} />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-4">
              <div className={`${bar} h-12 sm:h-14 rounded-xl`} />
              <div className={`${bar} h-12 sm:h-14 rounded-xl`} />
            </div>
          </div>
          <div className={`${card} h-[148px] sm:h-[200px] space-y-4 overflow-hidden`}>
            <div className="flex items-center justify-between">
              <div className={`${bar} h-5 w-24`} />
              <div className={`${bar} h-5 w-16`} />
            </div>
            <div className={`${bar} h-12 rounded-xl`} />
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className={`${card} h-[62px] lg:h-[256px] overflow-hidden space-y-4`}>
            <div className={`${bar} h-5 w-28`} />
            <div className={`${bar} hidden lg:block h-10 w-40`} />
            <div className={`${bar} hidden lg:block h-12 rounded-xl`} />
          </div>
        </div>
        <div className="h-px w-full -mt-2 sm:-mt-5 lg:hidden" aria-hidden="true" />
      </div>
    </div>
  );
}

/** Matches DashboardView: header, hero Profit Story + Waterfall card, 7/5 analytics row, and Daily Sheets ledger. */
// The Overview header also carries the "+ 记账" / "+ Today's Sheet" button; its
// hidden label wraps the row onto two lines exactly when the real one does
// (English on phones), so the content below starts at the same height.
function DashboardHeaderBar() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className={`${bar} h-8 w-44`} />
      <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2">
        <MonthPickerBar />
        <div aria-hidden="true" className={`${bar} h-12 lg:h-11 px-3 sm:px-4 rounded-xl flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap shrink-0`}>
          <span className="invisible w-4 h-4 shrink-0" />
          <span className="invisible sm:hidden">{t.recordTodayShort}</span>
          <span className="invisible hidden sm:inline">{t.recordTodaySheet}</span>
        </div>
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <DashboardHeaderBar />

      <div className={`${card} grid grid-cols-1 md:grid-cols-12 gap-6`}>
        <div className="md:col-span-6 space-y-3">
          <div className={`${bar} h-4 w-24`} />
          <div className={`${bar} h-11 w-48`} />
          <div className={`${bar} h-4 w-full max-w-sm`} />
        </div>
        <div className="md:col-span-6 space-y-3">
          <div className={`${bar} h-5 w-full`} />
          <div className={`${bar} h-5 w-full`} />
          <div className={`${bar} h-5 w-full`} />
          <div className={`${bar} h-2.5 w-full rounded-full`} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-surface border border-surface-border rounded-2xl shadow-card overflow-hidden">
          <div className="bg-surface-subtle dark:bg-surface-canvas border-b border-surface-border px-3 pt-2 flex items-end gap-1.5">
            <div className="h-10 w-28 rounded-t-xl bg-surface border border-surface-border border-b-0" />
            <div className={`${bar} h-8 w-24 mb-1`} />
          </div>
          <div className="p-5 sm:p-6 space-y-4">
            <div className={`${bar} h-4 w-56`} />
            <div className={`${bar} h-56 rounded-xl`} />
          </div>
        </div>
        <div className="lg:col-span-5 space-y-5">
          <div className={`${card} space-y-3`}>
            <div className={`${bar} h-5 w-32`} />
            <div className={`${bar} h-3 w-full rounded-full`} />
            <div className={`${bar} h-12 rounded-xl`} />
          </div>
          <div className={`${card} space-y-3`}>
            <div className={`${bar} h-5 w-32`} />
            <div className={`${bar} h-10 rounded-xl`} />
            <div className={`${bar} h-10 rounded-xl`} />
          </div>
        </div>
      </div>

      <div className={`${card} space-y-3`}>
        <div className={`${bar} h-5 w-32`} />
        <div className={`${bar} h-12 rounded-xl`} />
        <div className={`${bar} h-12 rounded-xl`} />
      </div>
    </div>
  );
}

/** Matches ExpensesView: header, 5/7 desktop grid with Profit Impact card and Recorded Items card. */
export function ExpensesSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <HeaderBar />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className={`lg:col-span-5 ${card} space-y-4`}>
          <div className={`${bar} h-4 w-28`} />
          <div className={`${bar} h-10 w-40`} />
          <div className={`${bar} h-2.5 w-full rounded-full`} />
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className={`${bar} h-14 rounded-xl`} />
            <div className={`${bar} h-14 rounded-xl`} />
          </div>
        </div>
        <div className={`lg:col-span-7 ${card} space-y-3`}>
          <div className={`${bar} h-5 w-28`} />
          <div className={`${bar} h-14 rounded-xl`} />
          <div className={`${bar} h-14 rounded-xl`} />
          <div className={`${bar} h-12 rounded-xl`} />
        </div>
      </div>
    </div>
  );
}

/** Matches MonthCloseView: header, 5/7 desktop grid with Book Summary waterfall and Reconciliation card. */
export function MonthCloseSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <HeaderBar />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className={`lg:col-span-5 ${card} space-y-3`}>
          <div className={`${bar} h-5 w-32`} />
          <div className={`${bar} h-6 w-full`} />
          <div className={`${bar} h-6 w-full`} />
          <div className={`${bar} h-6 w-full`} />
          <div className={`${bar} h-10 w-full mt-2`} />
        </div>
        <div className={`lg:col-span-7 ${card} space-y-4`}>
          <div className={`${bar} h-5 w-32`} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={`${bar} h-20 rounded-xl`} />
            <div className={`${bar} h-20 rounded-xl`} />
          </div>
          <div className={`${bar} h-24 rounded-xl`} />
          <div className={`${bar} h-12 rounded-xl`} />
        </div>
      </div>
    </div>
  );
}
