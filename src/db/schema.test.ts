import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
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
      "month_close_events",
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

  describe("Operating Expense identity (month, type, note) is unique", () => {
    const insertOpex = (month: string, type: string, note: string | null) =>
      db
        .insert(operatingExpenses)
        .values({ month, type, amountSen: 100, note })
        .run();

    it("rejects a second row with the same non-NULL note", () => {
      insertOpex("2025-01", "rental", "stall A");
      expect(() => insertOpex("2025-01", "rental", "stall A")).toThrow(
        /UNIQUE/,
      );
    });

    it("rejects a second row with a NULL note (NULLs are not distinct here)", () => {
      insertOpex("2025-02", "utilities", null);
      expect(() => insertOpex("2025-02", "utilities", null)).toThrow(/UNIQUE/);
    });

    it("allows distinct notes, NULL beside a note, and other months/types", () => {
      insertOpex("2025-03", "wages", "A");
      insertOpex("2025-03", "wages", "B");
      insertOpex("2025-03", "wages", null);
      insertOpex("2025-03", "rental", null);
      insertOpex("2025-04", "wages", null);
      insertOpex("2025-04", "wages", "A");
      const rows = sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM operating_expenses WHERE month IN ('2025-03','2025-04')",
        )
        .get() as { n: number };
      expect(rows.n).toBe(6);
    });

    it("rejects an UPDATE that moves a row onto an existing identity", () => {
      insertOpex("2025-05", "rental", null);
      insertOpex("2025-05", "rental", "x");
      expect(() =>
        sqlite
          .prepare(
            "UPDATE operating_expenses SET note = NULL WHERE month = '2025-05' AND note = 'x'",
          )
          .run(),
      ).toThrow(/UNIQUE/);
    });
  });

  describe("CHECK constraints mirror service validation", () => {
    let sheetId: number;
    beforeAll(() => {
      sheetId = db
        .insert(dailySheets)
        .values({ date: "2026-08-01" })
        .returning({ id: dailySheets.id })
        .get()!.id;
    });

    const insertCostLine = (amountSen: number, category: string, note: string | null) =>
      db
        .insert(costLines)
        .values({ dailySheetId: sheetId, amountSen, category, note })
        .run();
    const insertOpex = (type: string, note: string | null, amountSen = 100) =>
      db
        .insert(operatingExpenses)
        .values({ month: "2024-01", type, amountSen, note })
        .run();
    const insertClose = (
      month: string,
      cashOnHandSen: number | null,
      tngOnHandSen: number | null,
    ) =>
      db
        .insert(monthCloses)
        .values({
          month,
          revenueSen: 0,
          dailyCostSen: 0,
          grossSen: 0,
          operatingSen: 0,
          netSen: 0,
          cashOnHandSen,
          tngOnHandSen,
        })
        .run();

    const blankNotes = ["", " ", "   ", "\t", " \n\r\t\v\f "];

    it("rejects blank or whitespace-only notes on 'other' Cost Lines", () => {
      for (const note of blankNotes) {
        expect(() => insertCostLine(100, "other", note)).toThrow(
          /chk_cost_lines_other_note/,
        );
      }
      expect(() => insertCostLine(100, "other", "  gas top-up  ")).not.toThrow();
      expect(() => insertCostLine(100, "gas", null)).not.toThrow();
      expect(() => insertCostLine(100, "gas", "   ")).not.toThrow();
    });

    it("rejects zero-amount Cost Lines, accepts 1 sen", () => {
      expect(() => insertCostLine(0, "restock", null)).toThrow(
        /chk_cost_lines_amount_positive/,
      );
      expect(() => insertCostLine(1, "restock", null)).not.toThrow();
      expect(() =>
        sqlite
          .prepare("UPDATE cost_lines SET amount_sen = 0 WHERE daily_sheet_id = ?")
          .run(sheetId),
      ).toThrow(/chk_cost_lines_amount_positive/);
    });

    it("requires a non-blank note on 'other' Operating Expenses", () => {
      expect(() => insertOpex("other", null)).toThrow(/chk_opex_other_note/);
      for (const note of blankNotes) {
        expect(() => insertOpex("other", note)).toThrow(/chk_opex_other_note/);
      }
      expect(() => insertOpex("other", "Licensing renewal fee")).not.toThrow();
      expect(() => insertOpex("rental", null)).not.toThrow();
      // A zero Operating Expense is still allowed (only Cost Lines must be > 0).
      expect(() => insertOpex("utilities", null, 0)).not.toThrow();
      expect(() =>
        sqlite
          .prepare(
            "UPDATE operating_expenses SET type = 'other' WHERE month = '2024-01' AND type = 'rental'",
          )
          .run(),
      ).toThrow(/chk_opex_other_note/);
    });

    it("rejects negative on-hand amounts on month_closes, allows 0 and NULL", () => {
      expect(() => insertClose("2024-01", -1, 0)).toThrow(
        /chk_month_closes_cash_on_hand_nonneg/,
      );
      expect(() => insertClose("2024-01", 0, -1)).toThrow(
        /chk_month_closes_tng_on_hand_nonneg/,
      );
      expect(() => insertClose("2024-01", 0, 0)).not.toThrow();
      // Legacy closes predating Reconciliation inputs keep NULL on-hand columns.
      expect(() => insertClose("2024-02", null, null)).not.toThrow();
      expect(() =>
        sqlite
          .prepare("UPDATE month_closes SET cash_on_hand_sen = -5 WHERE month = '2024-02'")
          .run(),
      ).toThrow(/chk_month_closes_cash_on_hand_nonneg/);
    });
  });
});

describe("migration 0007 (CHECK tightening table rebuild)", () => {
  it("preserves rows, ids and AUTOINCREMENT high-water marks", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-mig0007-"));
    try {
      // Migrations folder truncated to 0000-0006: the state before 0007.
      const full = path.resolve(process.cwd(), "drizzle");
      const pre = path.join(dir, "drizzle-pre");
      fs.cpSync(full, pre, { recursive: true });
      const journalPath = path.join(pre, "meta", "_journal.json");
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
      journal.entries = journal.entries.filter(
        (e: { idx: number }) => e.idx < 7,
      );
      fs.writeFileSync(journalPath, JSON.stringify(journal));

      const dbPath = path.join(dir, "mig.db");
      const opened = openDb(dbPath);
      const raw = opened.sqlite;
      try {
        migrate(opened.db, { migrationsFolder: pre });
        raw.exec(`
          INSERT INTO daily_sheets (date) VALUES ('2026-01-01');
          INSERT INTO cost_lines (daily_sheet_id, amount_sen, category, note)
            VALUES (1, 100, 'gas', NULL), (1, 200, 'other', 'x'), (1, 300, 'restock', NULL);
          DELETE FROM cost_lines WHERE amount_sen = 300;
          INSERT INTO operating_expenses (month, type, amount_sen) VALUES ('2026-01', 'rental', 1);
          DELETE FROM operating_expenses;
          INSERT INTO month_closes (month, revenue_sen, daily_cost_sen, gross_sen, operating_sen, net_sen)
            VALUES ('2025-12', 0, 0, 0, 0, 0);
        `);
        const before = raw.prepare("SELECT * FROM cost_lines ORDER BY id").all();
        const closeBefore = raw.prepare("SELECT * FROM month_closes").all();

        migrate(opened.db, { migrationsFolder: full });

        expect(raw.prepare("SELECT * FROM cost_lines ORDER BY id").all()).toEqual(before);
        // Legacy close with NULL on-hand columns survives the rebuild.
        expect(raw.prepare("SELECT * FROM month_closes").all()).toEqual(closeBefore);
        const seq = Object.fromEntries(
          (
            raw.prepare("SELECT name, seq FROM sqlite_sequence").all() as Array<{
              name: string;
              seq: number;
            }>
          ).map((r) => [r.name, r.seq]),
        );
        expect(seq).toMatchObject({ cost_lines: 3, operating_expenses: 1, month_closes: 1 });
        expect(Object.keys(seq).some((n) => n.startsWith("__new_"))).toBe(false);
        // Deleted ids are not reused after the rebuild.
        raw.exec("INSERT INTO operating_expenses (month, type, amount_sen) VALUES ('2026-01', 'rental', 1)");
        expect(
          (raw.prepare("SELECT id FROM operating_expenses").get() as { id: number }).id,
        ).toBe(2);
        expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(raw.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
      } finally {
        raw.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
