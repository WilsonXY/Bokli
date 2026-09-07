import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openDb, type Db } from "./index";
import {
  costLines,
  dailySheets,
  monthCloses,
  operatingExpenses,
  users,
} from "./schema";

import { runMigrations } from "./migrate";

let tmpDir: string;
let db: Db;
let sqlite: import("better-sqlite3").Database;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  const opened = openDb(dbPath);
  db = opened.db;
  sqlite = opened.sqlite;
  runMigrations(dbPath);
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("schema sanity", () => {
  it("creates all tables", () => {
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((r) => r.name);
    for (const t of [
      "users",
      "daily_sheets",
      "cost_lines",
      "operating_expenses",
      "month_closes",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("stores amounts as INTEGER columns", () => {
    const info = sqlite
      .prepare("PRAGMA table_info(daily_sheets)")
      .all() as Array<{ name: string; type: string }>;
    const cash = info.find((c) => c.name === "cash_sen");
    const tng = info.find((c) => c.name === "tng_sen");
    expect(cash?.type).toBe("INTEGER");
    expect(tng?.type).toBe("INTEGER");
  });

  it("enforces unique username in users table", () => {
    db.insert(users)
      .values({
        username: "testuser",
        passwordHash: "hash1",
        role: "Operator",
      })
      .run();
    expect(() =>
      db
        .insert(users)
        .values({
          username: "testuser",
          passwordHash: "hash2",
          role: "Admin",
        })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("rejects invalid roles via CHECK constraint", () => {
    expect(() =>
      db
        .insert(users)
        .values({
          username: "invalidrole",
          passwordHash: "hash",
          role: "SuperAdmin" as any,
        })
        .run(),
    ).toThrow(/CHECK/);
  });

  it("enforces one Daily Sheet per date (unique)", () => {
    db.insert(dailySheets).values({ date: "2026-09-01" }).run();
    expect(() =>
      db.insert(dailySheets).values({ date: "2026-09-01" }).run(),
    ).toThrow(/UNIQUE/);
  });

  it("rejects invalid Cost Categories via CHECK", () => {
    const sheet = db
      .insert(dailySheets)
      .values({ date: "2026-09-02" })
      .returning({ id: dailySheets.id })
      .get()!;
    expect(() =>
      db
        .insert(costLines)
        .values({ dailySheetId: sheet.id, amountSen: 100, category: "snacks" })
        .run(),
    ).toThrow(/CHECK/);
  });

  it("requires note when Cost Category is other", () => {
    const sheet = db
      .insert(dailySheets)
      .values({ date: "2026-09-03" })
      .returning({ id: dailySheets.id })
      .get()!;
    expect(() =>
      db
        .insert(costLines)
        .values({ dailySheetId: sheet.id, amountSen: 100, category: "other" })
        .run(),
    ).toThrow(/CHECK/);
    // with note it works
    db.insert(costLines)
      .values({ dailySheetId: sheet.id, amountSen: 100, category: "other", note: "misc" })
      .run();
  });

  it("rejects invalid Operating Expense types", () => {
    expect(() =>
      db
        .insert(operatingExpenses)
        .values({ month: "2026-09", type: "insurance", amountSen: 100 })
        .run(),
    ).toThrow(/CHECK/);
  });

  it("enforces one Month Close per month (unique)", () => {
    db.insert(monthCloses)
      .values({
        month: "2026-08",
        revenueSen: 0,
        dailyCostSen: 0,
        grossSen: 0,
        operatingSen: 0,
        netSen: 0,
      })
      .run();
    expect(() =>
      db
        .insert(monthCloses)
        .values({
          month: "2026-08",
          revenueSen: 1,
          dailyCostSen: 0,
          grossSen: 1,
          operatingSen: 0,
          netSen: 1,
        })
        .run(),
    ).toThrow(/UNIQUE/);
  });
});
