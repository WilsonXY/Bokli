"use client";

import { CloudPage } from "@/components/CloudPage";
import { MonthCloseSkeleton } from "@/components/Skeletons";
import { MonthCloseView } from "@/components/MonthCloseView";
import { cloudRead } from "@/lib/cloud-client";
import { formatKlDate, formatKlDateTime } from "@/lib/datetime";

async function load(query: string) {
  // The close read already carries the signed-in role; a separate identity
  // read could stall and make every Retry wait on the same request.
  const page = await cloudRead("close", query);
  const c = page.closeRecord;
  return {
    currentMonth: page.activeMonth,
    availableMonths: page.availableMonths,
    monthOptions: page.monthOptions,
    financials: page.financials,
    hasSheetsInMonth: page.hasSheetsInMonth,
    // Only an Admin sees Reopen; the Worker enforces it again on the write.
    userRole: page.userRole,
    closeRecord: c && {
      isClosed: !c.reopenedAt,
      isReopened: Boolean(c.reopenedAt),
      closedAt: c.closedAt ? formatKlDateTime(c.closedAt) : c.closedAt,
      reopenedAt: c.reopenedAt ? formatKlDate(c.reopenedAt) : c.reopenedAt,
      reopenReason: c.reopenReason,
      cashOnHandSen: Number(c.cashOnHandSen),
      tngOnHandSen: Number(c.tngOnHandSen),
      expectedSen: c.expectedSen,
      actualSen: c.actualSen,
      differenceSen: c.differenceSen,
      balanced: c.balanced,
      note: c.note,
    },
  };
}

export default function MonthClosePage() {
  return (
    <CloudPage
      param="month"
      load={load}
      skeleton={<MonthCloseSkeleton />}
      render={(props, reload) => <MonthCloseView key={props.currentMonth} {...props} onRefresh={reload} />}
    />
  );
}
