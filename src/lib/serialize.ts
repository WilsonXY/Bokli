import type { MonthTile } from "@/services/dashboard";
import type { SerializedMonthTile } from "@/components/DashboardView";

/**
 * Month Tile -> client-safe props (bigint sen -> number).
 * `balanced` is only emitted when the service set it (closed months); open
 * and reopened months have no reconciliation, so the key is omitted rather
 * than coerced to `false`.
 */
export function serializeTile(t: MonthTile): SerializedMonthTile {
  return {
    month: t.month,
    revenueSen: Number(t.revenueSen),
    dailyCostSen: Number(t.dailyCostSen),
    grossSen: Number(t.grossSen),
    operatingSen: Number(t.operatingSen),
    netSen: Number(t.netSen),
    status: t.status,
    ...(t.balanced !== undefined ? { balanced: t.balanced } : {}),
  };
}
