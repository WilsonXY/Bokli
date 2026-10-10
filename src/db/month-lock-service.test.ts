import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, expect, it } from "vitest";
import * as schema from "./schema";
import { closeMonth, reopenMonth } from "../services/month-close";
import { addOperatingExpense, removeOperatingExpense, wasOperatingExpenseAddSaved } from "../services/operating-expense";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "drizzle" });
});
afterEach(() => sqlite.close());
const now = new Date("2025-04-01T00:00:00Z");

it("keeps expense replay/status after deletion and a later Month Close without recreating the expense", async () => {
  const options = { db, idempotencyKey: "synthetic-deleted-closed" };
  const first = await addOperatingExpense("2025-01", "rental", 1, null, options);
  await removeOperatingExpense(first.id, { db });
  await closeMonth("2025-01", 0, 0, null, { db, now, confirmEmpty: true });
  const receipt = sqlite.prepare("SELECT * FROM operating_expense_add_requests").all();
  expect(await addOperatingExpense("2025-01", "rental", 1, null, options)).toEqual({ ...first, alreadySaved: true });
  expect(await wasOperatingExpenseAddSaved(options.idempotencyKey, { db })).toBe(true);
  await expect(addOperatingExpense("2025-01", "rental", 2, null, options)).rejects.toThrow("different Operating Expense");
  await expect(addOperatingExpense("2025-01", "rental", 1, null, { db, idempotencyKey: "synthetic-new" })).rejects.toThrow("closed");
  expect(sqlite.prepare("SELECT * FROM operating_expenses").all()).toEqual([]);
  expect(sqlite.prepare("SELECT * FROM operating_expense_add_requests").all()).toEqual(receipt);
  expect(sqlite.prepare("SELECT action FROM month_close_events").all()).toEqual([{ action: "close" }]);
});

it("keeps one audit per close/reopen/reclose and rolls back failed audit or unauthorized operations", async () => {
  sqlite.exec("INSERT INTO daily_sheets(date,cash_sen) VALUES('2025-01-01',10)");
  await closeMonth("2025-01", 10, 0, null, { db, now });
  await expect(closeMonth("2025-01", 10, 0, null, { db, now })).rejects.toThrow("already closed");
  await expect(reopenMonth("2025-01", "correction", { db, role: "Operator", now })).rejects.toThrow("Admin");
  await expect(reopenMonth("2025-01", " ", { db, role: "Admin", now })).rejects.toThrow("reason");
  await reopenMonth("2025-01", "correction", { db, role: "Admin", now });
  sqlite.exec("UPDATE daily_sheets SET cash_sen=11");
  const state = sqlite.prepare("SELECT * FROM month_closes").all();
  sqlite.exec("CREATE TEMP TRIGGER synthetic_audit_failure BEFORE INSERT ON month_close_events BEGIN SELECT RAISE(ABORT,'SYNTHETIC_FAILURE'); END");
  await expect(closeMonth("2025-01", 11, 0, null, { db, now })).rejects.toThrow("SYNTHETIC_FAILURE");
  expect(sqlite.prepare("SELECT * FROM month_closes").all()).toEqual(state);
  expect(sqlite.prepare("SELECT action FROM month_close_events ORDER BY id").all()).toEqual([{ action: "close" }, { action: "reopen" }]);
  sqlite.exec("DROP TRIGGER temp.synthetic_audit_failure");
  await closeMonth("2025-01", 11, 0, null, { db, now });
  expect(sqlite.prepare("SELECT action FROM month_close_events ORDER BY id").all()).toEqual([{ action: "close" }, { action: "reopen" }, { action: "close" }]);
  expect(() => sqlite.exec("UPDATE daily_sheets SET cash_sen=12")).toThrow("BOKLI_MONTH_LOCKED");
});
