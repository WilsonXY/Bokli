import React from "react";
import { eq, like } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { dailySheets, monthCloses } from "@/db/schema";
import { listMonthTiles, type MonthTile } from "@/services/dashboard";
import { getTodayInKualaLumpur } from "@/services/daily-sheet";
import { isValidMonthStr } from "@/lib/money";
import { getMonthPreview } from "@/services/operating-expense";
import { getClose } from "@/services/month-close";
import { MonthCloseView, type CloseRecordData } from "@/components/MonthCloseView";
import { formatKlDate, formatKlDateTime } from "@/lib/datetime";

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
  let rawTiles: MonthTile[] = [];
  let loadError: string | null = null;

  try {
    rawTiles = await listMonthTiles();
  } catch (err) {
    console.error("Failed to list month tiles for month close:", err);
    loadError = "Failed to load month close data. Please refresh or try again later.";
  }

  // Active month: requested valid month, or first existing non-future month, or current month
  let activeMonth =
    requestedMonth && isValidMonthStr(requestedMonth)
      ? requestedMonth
      : rawTiles.find((t) => t.month <= currentMonthInKL)?.month ?? currentMonthInKL;

  // Disallow future months for month close
  if (activeMonth > currentMonthInKL) {
    activeMonth = currentMonthInKL;
  }

  // Available months: filter out any future months
  const monthSet = new Set<string>([currentMonthInKL, activeMonth]);
  const tileStatusMap = new Map<string, "open" | "closed" | "reopened">();
  for (const t of rawTiles) {
    if (t.month <= currentMonthInKL) {
      monthSet.add(t.month);
      tileStatusMap.set(t.month, t.status);
    }
  }
  const availableMonths = Array.from(monthSet).sort().reverse();
  const monthOptions = availableMonths.map((m) => ({
    month: m,
    status: tileStatusMap.get(m) ?? "open",
  }));

  const { db } = getDb();

  let financials: {
    revenueSen: number;
    dailyCostSen: number;
    grossSen: number;
    operatingSen: number;
    netSen: number;
  } | null = null;

  let closeRecord: CloseRecordData | null = null;
  let hasSheetsInMonth = false;

  if (!loadError) {
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
          closedAt: rawClose.closedAt ? formatKlDateTime(rawClose.closedAt) : rawClose.closedAt,
          reopenedAt: rawClose.reopenedAt ? formatKlDate(rawClose.reopenedAt) : rawClose.reopenedAt,
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
    } catch (err) {
      console.error(`Failed to load month close data for ${activeMonth}:`, err);
      loadError = "Failed to load month data. Please refresh or try again later.";
    }
  }

  return (
    <MonthCloseView
      key={activeMonth}
      currentMonth={activeMonth}
      availableMonths={availableMonths}
      financials={loadError ? null : financials}
      closeRecord={closeRecord}
      userRole={session?.user?.role}
      hasSheetsInMonth={hasSheetsInMonth}
      monthOptions={monthOptions}
      loadError={loadError}
    />
  );
}
