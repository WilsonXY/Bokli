import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openDb, getDb, closeDb, type Db } from "./index";
import {
  costLines,
  dailySheets,
  loginAttempts,
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
      "login_attempts",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("creates index on login_attempts.updated_at for efficient cleanup", () => {
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all() as Array<{ name: string }>;
    const names = indexes.map((r) => r.name);
    expect(names).toContain("idx_login_attempts_updated_at");
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
        .values({
          dailySheetId: sheet.id,
          amountSen: 1000,
          category: "invalid-category" as any,
        })
        .run(),
    ).toThrow(/CHECK/);
  });

  it("enforces note when Cost Category is 'other'", () => {
    const sheet = db
      .insert(dailySheets)
      .values({ date: "2026-09-03" })
      .returning({ id: dailySheets.id })
      .get()!;
    // other without note fails
    expect(() =>
      db
        .insert(costLines)
        .values({
          dailySheetId: sheet.id,
          amountSen: 1000,
          category: "other",
          note: null,
        })
        .run(),
    ).toThrow(/CHECK/);

    // other with note succeeds
    expect(() =>
      db
        .insert(costLines)
        .values({
          dailySheetId: sheet.id,
          amountSen: 1000,
          category: "other",
          note: "Repaired blender blade",
        })
        .run(),
    ).not.toThrow();
  });

  it("rejects negative amounts via CHECK", () => {
    const sheet = db
      .insert(dailySheets)
      .values({ date: "2026-09-04" })
      .returning({ id: dailySheets.id })
      .get()!;
    expect(() =>
      db
        .insert(costLines)
        .values({
          dailySheetId: sheet.id,
          amountSen: -500,
          category: "restock",
        })
        .run(),
    ).toThrow(/CHECK/);
  });

  it("enforces one month_closes row per month (unique)", () => {
    db.insert(monthCloses)
      .values({
        month: "2026-09",
        revenueSen: 100000,
        dailyCostSen: 40000,
        grossSen: 60000,
        operatingSen: 20000,
        netSen: 40000,
      })
      .run();
    expect(() =>
      db
        .insert(monthCloses)
        .values({
          month: "2026-09",
          revenueSen: 100000,
          dailyCostSen: 40000,
          grossSen: 60000,
          operatingSen: 20000,
          netSen: 40000,
        })
        .run(),
    ).toThrow(/UNIQUE/);
  });
});
