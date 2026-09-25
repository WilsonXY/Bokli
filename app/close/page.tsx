import React from "react";
import { getTodayInKualaLumpur } from "@/lib/datetime";
import { dailySheetInMonth } from "@/services/daily-sheet";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { dailySheets, monthCloses } from "@/db/schema";
import { listMonthTiles, type MonthTile } from "@/services/dashboard";
import { isValidMonthStr } from "@/lib/money";
import { resolveActiveMonthView } from "@/lib/months";
import { describeLoadError } from "@/lib/page-load";
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
    rawTiles = await listMonthTiles({ upToMonth: currentMonthInKL });
  } catch (err) {
    console.error("Failed to list month tiles for month close:", err);
    loadError = describeLoadError("month close");
  }

  const { activeMonth, availableMonths, monthOptions } = resolveActiveMonthView(
    requestedMonth,
    rawTiles,
    currentMonthInKL,
  );

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
      // getDb() must stay inside the try: an unreachable DB throws here, and
      // outside it the throw would bypass loadError and hit the error boundary.
      const { db } = getDb();
      const [preview, rawClose, sheets] = await Promise.all([
        getMonthPreview(activeMonth, { db }),
        getClose(activeMonth, { db }),
        db
          .select({ id: dailySheets.id })
          .from(dailySheets)
          .where(dailySheetInMonth(activeMonth))
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
      loadError = describeLoadError("month");
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
