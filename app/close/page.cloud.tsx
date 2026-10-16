"use client";

import { CloudPage } from "@/components/CloudPage";
import { MonthCloseView } from "@/components/MonthCloseView";
import { cloudIdentity, cloudRead } from "@/lib/cloud-client";
import { formatKlDate, formatKlDateTime } from "@/lib/datetime";

async function load(query: string) {
  const [page, identity] = await Promise.all([cloudRead("close", query), cloudIdentity()]);
  const c = page.closeRecord;
  return {
    currentMonth: page.activeMonth,
    availableMonths: page.availableMonths,
    monthOptions: page.monthOptions,
    financials: page.financials,
    hasSheetsInMonth: page.hasSheetsInMonth,
    // Only an Admin sees Reopen; the Worker enforces it again on the write.
    userRole: identity.role,
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
      render={(props, reload) => <MonthCloseView key={props.currentMonth} {...props} onRefresh={reload} />}
    />
  );
}
