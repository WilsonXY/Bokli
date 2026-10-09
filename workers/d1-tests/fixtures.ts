import type { NewCostLine, NewDailySheet } from "../../src/db/schema";

// Synthetic values only. Never seed from an app DB, environment or account.
export const sheetFixture = {
  id: 41, date: "2026-01-02", cashSen: 1234, tngSen: 567, note: "original",
} satisfies NewDailySheet;

export const costLineFixtures = [
  { id: 11, dailySheetId: 41, amountSen: 250, category: "restock", note: "first" },
  { id: 12, dailySheetId: 41, amountSen: 300, category: "gas", note: "second" },
] satisfies NewCostLine[];
