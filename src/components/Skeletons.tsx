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

/** Matches DailySheetForm: header + date toolbar, 7/5 desktop split with Revenue + Daily Costs on left, Day Summary on right. */
export function DailySheetSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className={`${bar} h-8 w-36`} />
        <div className={`${bar} h-12 w-full sm:w-80 rounded-xl`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-7 space-y-5">
          <div className={`${card} space-y-4`}>
            <div className="flex items-center justify-between">
              <div className={`${bar} h-5 w-24`} />
              <div className={`${bar} h-5 w-28`} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={`${bar} h-20 rounded-xl`} />
              <div className={`${bar} h-20 rounded-xl`} />
            </div>
          </div>

          <div className={`${card} space-y-4`}>
            <div className="flex items-center justify-between">
              <div className={`${bar} h-5 w-24`} />
              <div className={`${bar} h-5 w-28`} />
            </div>
            <div className={`${bar} h-16 rounded-xl`} />
            <div className={`${bar} h-12 rounded-xl`} />
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className={`${card} space-y-4`}>
            <div className={`${bar} h-5 w-28`} />
            <div className={`${bar} h-10 w-40`} />
            <div className={`${bar} h-12 rounded-xl`} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Matches DashboardView: header, hero Profit Story + Waterfall card, 7/5 analytics row, and Daily Sheets ledger. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <HeaderBar />

      <div className={`${card} grid grid-cols-1 lg:grid-cols-12 gap-6`}>
        <div className="lg:col-span-6 space-y-3">
          <div className={`${bar} h-4 w-24`} />
          <div className={`${bar} h-11 w-48`} />
          <div className={`${bar} h-4 w-full max-w-sm`} />
        </div>
        <div className="lg:col-span-6 space-y-3">
          <div className={`${bar} h-5 w-full`} />
          <div className={`${bar} h-5 w-full`} />
          <div className={`${bar} h-5 w-full`} />
          <div className={`${bar} h-2.5 w-full rounded-full`} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className={`lg:col-span-7 ${card} space-y-4`}>
          <div className="flex items-center justify-between">
            <div className={`${bar} h-5 w-32`} />
            <div className={`${bar} h-9 w-36 rounded-xl`} />
          </div>
          <div className={`${bar} h-56 rounded-xl`} />
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
