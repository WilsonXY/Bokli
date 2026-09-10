import React from "react";
import { openDb } from "@/db";
import { listMonthTiles, type MonthTile } from "@/services/dashboard";
import { getTodayInKualaLumpur, isMonthClosed } from "@/services/daily-sheet";
import {
  getMonthPreview,
  listOperatingExpenses,
  type OperatingExpenseType,
} from "@/services/operating-expense";
import { ExpensesView, type OperatingExpenseItem } from "@/components/ExpensesView";

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
    rawTiles = await listMonthTiles();
  } catch (err) {
    console.error("Failed to list month tiles for expenses:", err);
    loadError = "Failed to load expenses data. Please refresh or try again later.";
  }

  // Active month: requested valid month, or first existing month, or current month
  let activeMonth =
    requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth)
      ? requestedMonth
      : rawTiles.length > 0
        ? rawTiles[0].month
        : currentMonthInKL;

  // Disallow future months: clamp to current month in KL
  if (activeMonth > currentMonthInKL) {
    activeMonth = currentMonthInKL;
  }

  const monthSet = new Set<string>([currentMonthInKL, activeMonth]);
  const tileStatusMap = new Map<string, "open" | "closed" | "reopened">();
  for (const t of rawTiles) {
    monthSet.add(t.month);
    tileStatusMap.set(t.month, t.status);
  }
  const availableMonths = Array.from(monthSet).sort().reverse();
  const monthOptions = availableMonths.map((m) => ({
    month: m,
    status: tileStatusMap.get(m) ?? "open",
  }));

  const { db } = openDb();
  let expenses: OperatingExpenseItem[] = [];
  let isClosed = false;
  let summary: {
    grossSen: number;
    operatingSen: number;
    netSen: number;
  } | null = null;

  if (!loadError) {
    try {
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
      loadError = "Failed to load expenses data. Please refresh or try again later.";
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
