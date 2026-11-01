"use client";

import { CloudPage } from "@/components/CloudPage";
import { DailySheetForm } from "@/components/DailySheetForm";
import { cloudRead } from "@/lib/cloud-client";
import type { CostCategory } from "@/lib/vocab";

async function load(query: string) {
  const { date, todayKl, isClosed, data } = await cloudRead("sheets", query);
  return {
    date,
    todayKl,
    isClosed,
    initialCashSen: data?.sheet.cashSen ?? 0,
    initialTngSen: data?.sheet.tngSen ?? 0,
    initialCostLines: (data?.costLines ?? []).map((l) => ({
      id: l.id,
      category: l.category as CostCategory,
      amountSen: l.amountSen,
      note: l.note,
    })),
    savedSheet: data ? { id: data.sheet.id, updatedAt: data.sheet.updatedAt } : null,
  };
}

export default function HomePage() {
  return (
    <CloudPage
      param="date"
      load={load}
      render={(props, reload) => (
        <div className="max-w-2xl mx-auto">
          <DailySheetForm key={props.date} {...props} onRefresh={reload} />
        </div>
      )}
    />
  );
}
