import type { MonthStatus, MonthTile } from "@/services/dashboard";
import { isValidMonthStr } from "@/lib/money";

export interface MonthOption {
  month: string;
  status: MonthStatus;
}

export interface ActiveMonthView {
  activeMonth: string;
  availableMonths: string[];
  monthOptions: MonthOption[];
}

/**
 * Resolve the Active Month and the month-selector options for a page.
 * - Active month: requested valid month, or first existing non-future month
 *   tile, or the current KL month; future months are clamped to the current
 *   KL month.
 * - Available months: current KL month + active month + every non-future
 *   tile month, newest first. Months without a tile default to "open".
 */
export function resolveActiveMonthView(
  requestedMonth: string | undefined,
  rawTiles: MonthTile[],
  currentMonthInKL: string,
): ActiveMonthView {
  let activeMonth =
    requestedMonth && isValidMonthStr(requestedMonth)
      ? requestedMonth
      : rawTiles.find((t) => t.month <= currentMonthInKL)?.month ?? currentMonthInKL;

  // Disallow future months: clamp to current month in KL
  if (activeMonth > currentMonthInKL) {
    activeMonth = currentMonthInKL;
  }

  const monthSet = new Set<string>([currentMonthInKL, activeMonth]);
  const tileStatusMap = new Map<string, MonthStatus>();
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

  return { activeMonth, availableMonths, monthOptions };
}
