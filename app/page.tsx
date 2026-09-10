import React from "react";
import {
  getTodayInKualaLumpur,
  getSheetWithCosts,
  isMonthClosed,
} from "@/services/daily-sheet";
import { getDb } from "@/db";
import { isValidDateStr } from "@/lib/money";
import { DailySheetForm } from "@/components/DailySheetForm";

interface PageProps {
  searchParams?: Promise<{ date?: string }>;
}

export default async function HomePage(props: PageProps) {
  const searchParams = await props.searchParams;
  const todayKl = getTodayInKualaLumpur();

  const requestedDate = searchParams?.date;
  const date =
    typeof requestedDate === "string" &&
    isValidDateStr(requestedDate) &&
    requestedDate <= todayKl
      ? requestedDate
      : todayKl;

  const { db } = getDb();
  const month = date.slice(0, 7);
  const isClosed = isMonthClosed(month, db);

  const sheetData = getSheetWithCosts(date, { db });

  return (
    <div className="max-w-2xl mx-auto">
      <DailySheetForm
        key={date}
        date={date}
        initialCashSen={sheetData ? Number(sheetData.sheet.cashSen) : 0}
        initialTngSen={sheetData ? Number(sheetData.sheet.tngSen) : 0}
        initialCostLines={
          sheetData
            ? sheetData.costLines.map((l) => ({
                id: l.id,
                category: l.category as any,
                amountSen: Number(l.amountSen),
                note: l.note,
              }))
            : []
        }
        isClosed={isClosed}
        todayKl={todayKl}
      />
    </div>
  );
}
