import { eq, like } from "drizzle-orm";
import { auth } from "@/auth";
import { openDb } from "@/db";
import { dailySheets, monthCloses } from "@/db/schema";
import { listMonthTiles } from "@/services/dashboard";
import { getTodayInKualaLumpur } from "@/services/daily-sheet";
import { getMonthPreview } from "@/services/operating-expense";
import { getClose, isFutureMonthInKL } from "@/services/month-close";
import { MonthCloseView } from "@/components/MonthCloseView";

interface PageProps {
  searchParams?: Promise<{ month?: string }>;
}

export default async function MonthClosePage(props: PageProps) {
  const [session, searchParams] = await Promise.all([
    auth(),
    props.searchParams,
  ]);

  const requestedMonth =
    typeof searchParams?.month === "string" ? searchParams.month : undefined;

  const currentMonthInKL = getTodayInKualaLumpur().slice(0, 7);
  const rawTiles = await listMonthTiles();

  // Active month: requested month, or first existing month, or current month
  let activeMonth =
    requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth)
      ? requestedMonth
      : rawTiles.length > 0
        ? rawTiles[0].month
        : currentMonthInKL;

  // Disallow future months for month close
  if (activeMonth > currentMonthInKL) {
    activeMonth = currentMonthInKL;
  }

  // Available months: filter out any future months
  const monthSet = new Set<string>([currentMonthInKL, activeMonth]);
  for (const t of rawTiles) {
    if (t.month <= currentMonthInKL) {
      monthSet.add(t.month);
    }
  }
  const availableMonths = Array.from(monthSet).sort().reverse();

  const { db } = openDb();

  let financials = {
    revenueSen: 0,
    dailyCostSen: 0,
    grossSen: 0,
    operatingSen: 0,
    netSen: 0,
  };

  let closeRecord: any = null;
  let hasSheetsInMonth = false;

  try {
    const [preview, rawClose, sheets] = await Promise.all([
      getMonthPreview(activeMonth, { db }),
      getClose(activeMonth, { db }),
      db
        .select({ id: dailySheets.id })
        .from(dailySheets)
        .where(like(dailySheets.date, `${activeMonth}-%`))
        .all(),
    ]);

    financials = {
      revenueSen: Number(preview.revenueSen),
      dailyCostSen: Number(preview.dailyCostSen),
      grossSen: Number(preview.grossSen),
      operatingSen: Number(preview.operatingSen),
      netSen: Number(preview.netSen),
    };

    hasSheetsInMonth = sheets.length > 0;

    if (rawClose) {
      closeRecord = {
        isClosed: !rawClose.reopenedAt,
        isReopened: Boolean(rawClose.reopenedAt),
        closedAt: rawClose.closedAt,
        reopenedAt: rawClose.reopenedAt,
        reopenReason: rawClose.reopenReason,
        cashOnHandSen: Number(rawClose.cashOnHandSen),
        tngOnHandSen: Number(rawClose.tngOnHandSen),
        expectedSen: Number(rawClose.expectedSen),
        actualSen: Number(rawClose.actualSen),
        differenceSen: Number(rawClose.differenceSen),
        balanced: rawClose.balanced,
        note: rawClose.note,
      };
    }
  } catch {
    // Fallback gracefully
  }

  return (
    <MonthCloseView
      key={activeMonth}
      currentMonth={activeMonth}
      availableMonths={availableMonths}
      financials={financials}
      closeRecord={closeRecord}
      userRole={session?.user?.role}
      hasSheetsInMonth={hasSheetsInMonth}
    />
  );
}
