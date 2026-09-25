import React from "react";
import {
  type CostCategory,
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

  // The whole data load stays inside the try, getDb() included: an unreachable
  // DB throws on acquisition, and outside the try that throw carries no scope
  // tag. DailySheetForm has no loadError UI to fall back on and rendering it
  // with zeroed figures would fabricate numbers, so log and re-throw for the
  // error boundary.
  try {
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
                  category: l.category as CostCategory,
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
  } catch (err) {
    console.error(`Failed to load daily sheet data for ${date}:`, err);
    throw err;
  }
}
