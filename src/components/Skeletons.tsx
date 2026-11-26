"use client";

import React from "react";

const bar = "rounded-lg bg-surface-subtle animate-pulse";
const card = "bg-surface border border-surface-border rounded-2xl p-5 sm:p-6 shadow-card";

function HeaderBar() {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className={`${bar} h-8 w-44`} />
      <div className="flex items-center gap-2">
        <div className={`${bar} h-11 w-40 rounded-xl`} />
      </div>
    </div>
  );
}

/**
 * Matches DailySheetForm box for box (scripts/cloud-flows/skeletons.mjs checks
 * it at 390px and 1280px): the same root spacing, a 36px title row over a 54px
 * date toolbar, then Revenue + Daily Costs (empty day) and the Save card, with
 * the same 1px sticky sentinel below on phones.
 */
export function DailySheetSkeleton() {
  return (
    <div className="space-y-3 sm:space-y-5" aria-busy="true">
      <div className="space-y-2.5 sm:space-y-3">
        <div className="flex flex-col gap-2.5 sm:gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center min-h-9">
            <div className={`${bar} h-8 w-36`} />
          </div>
          <div className={`${bar} h-[54px] w-full sm:w-[277px] rounded-xl`} />
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
export function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <HeaderBar />

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
    <div className="space-y-5" aria-busy="true">
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
    <div className="space-y-5" aria-busy="true">
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
