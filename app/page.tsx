import {
  getTodayInKualaLumpur,
  getSheetWithCosts,
  isMonthClosed,
} from "@/services/daily-sheet";
import { openDb } from "@/db";
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
    /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) &&
    requestedDate <= todayKl
      ? requestedDate
      : todayKl;

  const { db } = openDb();
  const month = date.slice(0, 7);
  const isClosed = isMonthClosed(month, db);

  const sheetData = getSheetWithCosts(date);

  return (
    <div className="max-w-2xl mx-auto">
      <DailySheetForm
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
