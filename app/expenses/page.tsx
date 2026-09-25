import React from "react";
import { getDb } from "@/db";
import { listMonthTiles, type MonthTile } from "@/services/dashboard";
import { getTodayInKualaLumpur } from "@/lib/datetime";
import { isMonthClosed } from "@/services/daily-sheet";
import {
  getMonthPreview,
  listOperatingExpenses,
  type OperatingExpenseType,
} from "@/services/operating-expense";
import { ExpensesView, type OperatingExpenseItem } from "@/components/ExpensesView";
import { resolveActiveMonthView } from "@/lib/months";
import { describeLoadError } from "@/lib/page-load";

interface PageProps {
  searchParams?: Promise<{ month?: string }>;
}

export default async function ExpensesPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const requestedMonth =
    typeof searchParams?.month === "string" ? searchParams.month : undefined;

  const currentMonthInKL = getTodayInKualaLumpur().slice(0, 7);
  let rawTiles: MonthTile[] = [];
  let loadError: string | null = null;

  try {
    rawTiles = await listMonthTiles({ upToMonth: currentMonthInKL });
  } catch (err) {
    console.error("Failed to list month tiles for expenses:", err);
    loadError = describeLoadError("expenses");
  }

  const { activeMonth, availableMonths, monthOptions } = resolveActiveMonthView(
    requestedMonth,
    rawTiles,
    currentMonthInKL,
  );

  let expenses: OperatingExpenseItem[] = [];
  let isClosed = false;
  let summary: {
    grossSen: number;
    operatingSen: number;
    netSen: number;
  } | null = null;

  if (!loadError) {
    try {
      // getDb() must stay inside the try: an unreachable DB throws here, and
      // outside it the throw would bypass loadError and hit the error boundary.
      const { db } = getDb();
      const [rawExpenses, preview] = await Promise.all([
        listOperatingExpenses(activeMonth, { db }),
        getMonthPreview(activeMonth, { db }),
      ]);

      isClosed = isMonthClosed(activeMonth, db);

      expenses = rawExpenses.map((e) => ({
        id: e.id,
        month: e.month,
        type: e.type as OperatingExpenseType,
        amountSen: Number(e.amountSen),
        note: e.note,
        createdAt: e.createdAt,
      }));

      summary = {
        grossSen: Number(preview.grossSen),
        operatingSen: Number(preview.operatingSen),
        netSen: Number(preview.netSen),
      };
    } catch (err) {
      console.error(`Failed to load expenses data for ${activeMonth}:`, err);
      loadError = describeLoadError("expenses");
    }
  }

  return (
    <ExpensesView
      key={activeMonth}
      currentMonth={activeMonth}
      availableMonths={availableMonths}
      initialExpenses={expenses}
      summary={loadError ? null : summary}
      isClosed={isClosed}
      monthOptions={monthOptions}
      loadError={loadError}
    />
  );
}
