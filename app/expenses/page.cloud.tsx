"use client";

import { CloudPage } from "@/components/CloudPage";
import { ExpensesView } from "@/components/ExpensesView";
import { cloudRead } from "@/lib/cloud-client";
import type { OperatingExpenseType } from "@/services/operating-expense";

async function load(query: string) {
  const { activeMonth, availableMonths, monthOptions, expenses, summary, isClosed } = await cloudRead("expenses", query);
  return {
    currentMonth: activeMonth,
    availableMonths,
    monthOptions,
    isClosed,
    summary,
    initialExpenses: expenses.map((e) => ({
      id: e.id,
      month: e.month,
      type: e.type as OperatingExpenseType,
      amountSen: e.amountSen,
      note: e.note,
      createdAt: e.createdAt,
    })),
  };
}

export default function ExpensesPage() {
  return (
    <CloudPage
      param="month"
      load={load}
      render={(props, reload) => <ExpensesView key={props.currentMonth} {...props} onRefresh={reload} />}
    />
  );
}
