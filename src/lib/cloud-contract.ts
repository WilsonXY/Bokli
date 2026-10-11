import type { UserRole } from "../db/schema";
import type { DashboardMonthData, MonthTile } from "../services/dashboard";
import type { DailySheetWithCosts, ReplaceCostLineInput } from "../services/daily-sheet";
import type { MonthPreview, AddOperatingExpenseResult } from "../services/operating-expense";
import type { MonthCloseWithReconciliation, MonthCloseHistoryItem } from "../services/month-close";
import type { OperatingExpense, MonthClose } from "../db/schema";
import type { MonthOption } from "./months";

/** Cloud generations always use this path, including on rollback. Never fall back to /api/*. */
export const CLOUD_API_PREFIX = "/api/cloud-v1";
export type Wire<T> = T extends bigint ? number : T extends readonly (infer U)[] ? Wire<U>[] : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;
export interface CloudReads {
  identity: { id: number; role: UserRole };
  dashboard: Wire<DashboardMonthData> & { activeMonth: string; tiles: Wire<MonthTile>[] };
  sheets: { date: string; todayKl: string; isClosed: boolean; data: Wire<DailySheetWithCosts> | null };
  expenses: { activeMonth: string; availableMonths: string[]; monthOptions: MonthOption[]; expenses: OperatingExpense[]; summary: Wire<MonthPreview>; isClosed: boolean };
  close: { activeMonth: string; availableMonths: string[]; monthOptions: MonthOption[]; financials: Wire<MonthPreview>; closeRecord: Wire<MonthCloseWithReconciliation> | null; hasSheetsInMonth: boolean; userRole: UserRole };
  history: Wire<MonthCloseHistoryItem>[];
}
export interface CloudFailure { code: string }
/** Stage4 implements these consumers, atomic receipts, roles and Origin/CSRF checks. Stage3 returns 405. */
export type CloudMutation =
  | { method: "POST"; path: "/api/cloud-v1/sheets"; body: { date: string; cashSen?: number; tngSen?: number; costLines: Wire<ReplaceCostLineInput>[] }; result: Wire<DailySheetWithCosts> }
  | { method: "DELETE"; path: "/api/cloud-v1/sheets"; query: { date: string; id: number; updatedAt: string }; result: { deleted: true; date: string } }
  | { method: "POST"; path: "/api/cloud-v1/expenses"; body: { month: string; type: string; amountSen: number; note?: string | null }; result: { expense: AddOperatingExpenseResult; merged: boolean; alreadySaved: boolean } }
  | { method: "DELETE"; path: "/api/cloud-v1/expenses"; body: { ids: number[] }; result: { deleted: number } }
  | { method: "POST"; path: "/api/cloud-v1/close"; body: { month: string; cashOnHandSen: number; tngOnHandSen: number; note?: string | null; confirmEmpty?: boolean }; result: { close: MonthClose; balanced: boolean; differenceSen: number; expectedSen: number; actualSen: number; warning?: string } }
  | { method: "POST"; path: "/api/cloud-v1/close/reopen"; body: { month: string; reason: string }; result: { close: MonthClose; message: string } };
export interface CloudMutationHeaders {
  /** Same durable random key/body on retries; Stage4 must scope it to verified identity. */
  "Idempotency-Key": string;
  /** Compatibility marker, never authentication; rollback rejects the namespace regardless of this header. */
  "X-Bokli-Api-Generation": "cloud-v1";
}
