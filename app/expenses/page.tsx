import { openDb } from "@/db";
import { listMonthTiles } from "@/services/dashboard";
import { getTodayInKualaLumpur, isMonthClosed } from "@/services/daily-sheet";
import {
  getMonthPreview,
  listOperatingExpenses,
} from "@/services/operating-expense";
import { ExpensesView } from "@/components/ExpensesView";

interface PageProps {
  searchParams?: Promise<{ month?: string }>;
}

export default async function ExpensesPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const requestedMonth =
    typeof searchParams?.month === "string" ? searchParams.month : undefined;

  const currentMonthInKL = getTodayInKualaLumpur().slice(0, 7);
  const rawTiles = await listMonthTiles();

  // Active month: requested valid month, or first existing month, or current month
  const activeMonth =
    requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth)
      ? requestedMonth
      : rawTiles.length > 0
        ? rawTiles[0].month
        : currentMonthInKL;

  const monthSet = new Set<string>([currentMonthInKL, activeMonth]);
  for (const t of rawTiles) {
    monthSet.add(t.month);
  }
  const availableMonths = Array.from(monthSet).sort().reverse();

  const { db } = openDb();
  let expenses: any[] = [];
  let isClosed = false;
  let summary = {
    grossSen: 0,
    operatingSen: 0,
    netSen: 0,
  };

  try {
    const [rawExpenses, preview] = await Promise.all([
      listOperatingExpenses(activeMonth, { db }),
      getMonthPreview(activeMonth, { db }),
    ]);

    isClosed = isMonthClosed(activeMonth, db);

    expenses = rawExpenses.map((e) => ({
      id: e.id,
      month: e.month,
      type: e.type,
      amountSen: Number(e.amountSen),
      note: e.note,
      createdAt: e.createdAt,
    }));

    summary = {
      grossSen: Number(preview.grossSen),
      operatingSen: Number(preview.operatingSen),
      netSen: Number(preview.netSen),
    };
  } catch {
    // Fallback gracefully on empty or uninitialized month
  }

  return (
    <ExpensesView
      key={activeMonth}
      currentMonth={activeMonth}
      availableMonths={availableMonths}
      initialExpenses={expenses}
      summary={summary}
      isClosed={isClosed}
    />
  );
}
