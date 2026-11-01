import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

import { getDb, openDb, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import {
  dailySheets,
  costLines,
  monthCloses,
  type DailySheet,
} from "@/db/schema";
import { getTodayInKualaLumpur, isFutureDateInKL } from "@/lib/datetime";
import { addCostLine, deleteSheet, getOrCreateSheet, getSheetWithCosts, removeCostLine, replaceCostLines, setRevenue, updateCostLine } from "./daily-sheet";
import {
  ClosedMonthError,
  ConflictError,
  FutureDateError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { consolidateCostLines } from "@/components/DailySheetForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let tmpDir: string;
let dbPath: string;
let db: Db;
let sqlite: import("better-sqlite3").Database;
const originalDbPath = process.env.BOKLI_DB_PATH;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-sheet-service-test-"));
  dbPath = path.join(tmpDir, "test.db");
  process.env.BOKLI_DB_PATH = dbPath;

  const opened = openDb(dbPath);
  db = opened.db;
  sqlite = opened.sqlite;
  runMigrations(dbPath);
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (originalDbPath) {
    process.env.BOKLI_DB_PATH = originalDbPath;
  } else {
    delete process.env.BOKLI_DB_PATH;
  }
});

describe("1. Unique-date enforcement", () => {
  it("creates a single Daily Sheet per date idempotently", () => {
    const sheet1 = getOrCreateSheet("2026-09-01", { db });
    expect(sheet1).toBeDefined();
    expect(sheet1.date).toBe("2026-09-01");
    expect(sheet1.cashSen).toBe(0);
    expect(sheet1.tngSen).toBe(0);

    const sheet2 = getOrCreateSheet("2026-09-01", { db });
    expect(sheet2.id).toBe(sheet1.id);

    const allSheets = db
      .select()
      .from(dailySheets)
      .where(eq(dailySheets.date, "2026-09-01"))
      .all();
    expect(allSheets).toHaveLength(1);
  });

  it("database enforces unique constraint on date", () => {
    expect(() => {
      db.insert(dailySheets).values({ date: "2026-09-01" }).run();
    }).toThrow(/UNIQUE/);
  });
});

describe("2. Future-date rejection (Asia/Kuala_Lumpur)", () => {
  it("accepts today and past dates in Asia/Kuala_Lumpur", () => {
    // 2026-09-07 15:30:00 UTC = 2026-09-07 23:30:00 in Asia/Kuala_Lumpur
    const mockNow = new Date("2026-09-07T15:30:00.000Z");
    expect(getTodayInKualaLumpur(mockNow)).toBe("2026-09-07");

    expect(isFutureDateInKL("2026-09-06", mockNow)).toBe(false);
    expect(isFutureDateInKL("2026-09-07", mockNow)).toBe(false);
    expect(isFutureDateInKL("2026-09-08", mockNow)).toBe(true);

    const sheet = getOrCreateSheet("2026-09-07", { db, now: mockNow });
    expect(sheet.date).toBe("2026-09-07");
  });

  it("rejects future dates in Asia/Kuala_Lumpur with FutureDateError", () => {
    const mockNow = new Date("2026-09-07T15:30:00.000Z");
    expect(() =>
      getOrCreateSheet("2026-09-08", { db, now: mockNow }),
    ).toThrow(FutureDateError);
    expect(() =>
      getOrCreateSheet("2026-10-01", { db, now: mockNow }),
    ).toThrow(/future/i);
  });

  it("correctly computes new day when UTC is previous day but Asia/Kuala_Lumpur has rolled over", () => {
    // 2026-09-07 16:15:00 UTC = 2026-09-08 00:15:00 in Asia/Kuala_Lumpur (+8 hours)
    const midnightAfterKL = new Date("2026-09-07T16:15:00.000Z");
    expect(getTodayInKualaLumpur(midnightAfterKL)).toBe("2026-09-08");

    // 2026-09-08 is NOT future in KL at this instant
    const sheet = getOrCreateSheet("2026-09-08", {
      db,
      now: midnightAfterKL,
    });
    expect(sheet.date).toBe("2026-09-08");

    // 2026-09-09 is still future in KL
    expect(() =>
      getOrCreateSheet("2026-09-09", { db, now: midnightAfterKL }),
    ).toThrow(FutureDateError);
  });

  it("rejects invalid date strings with ValidationError", () => {
    expect(() => getOrCreateSheet("not-a-date", { db })).toThrow(
      ValidationError,
    );
    expect(() => getOrCreateSheet("2026-02-30", { db })).toThrow(
      /Invalid date format/,
    );
    expect(() => getOrCreateSheet("2026-13-01", { db })).toThrow(
      /Invalid date format/,
    );
  });
});

describe("3. Cost Category CHECK and note requirement", () => {
  let sheet: DailySheet;

  beforeAll(() => {
    sheet = getOrCreateSheet("2026-09-03", { db });
  });

  it("accepts all valid fixed Cost Categories", () => {
    const validCategories = [
      "restock",
      "gas",
      "transport",
      "wages-daily",
      "maintenance",
    ] as const;

    for (const cat of validCategories) {
      const line = addCostLine(sheet.id, 1000n, cat, null, { db });
      expect(line.category).toBe(cat);
      expect(line.amountSen).toBe(1000);
      expect(line.dailySheetId).toBe(sheet.id);
    }
  });

  it("rejects invalid Cost Categories with ValidationError", () => {
    expect(() =>
      addCostLine(sheet.id, 500n, "snacks" as any, null, { db }),
    ).toThrow(ValidationError);
    expect(() =>
      addCostLine(sheet.id, 500n, "utilities" as any, null, { db }),
    ).toThrow(/Invalid Cost Category/);
  });

  it("requires non-empty note when category is 'other'", () => {
    // Missing or blank notes rejected
    expect(() =>
      addCostLine(sheet.id, 500n, "other", null, { db }),
    ).toThrow(ValidationError);
    expect(() =>
      addCostLine(sheet.id, 500n, "other", "", { db }),
    ).toThrow(ValidationError);
    expect(() =>
      addCostLine(sheet.id, 500n, "other", "   ", { db }),
    ).toThrow(/Note is required when Cost Category is 'other'/);
    expect(() =>
      addCostLine(sheet.id, 500n, "other", null, { db }),
    ).toThrow(expect.objectContaining({ code: "otherNoteRequired" }));

    // Valid note accepted
    const line = addCostLine(sheet.id, 500n, "other", "Plastic takeout containers", {
      db,
    });
    expect(line.category).toBe("other");
    expect(line.note).toBe("Plastic takeout containers");
  });

  it("rejects negative amounts with ValidationError", () => {
    expect(() =>
      addCostLine(sheet.id, -100n, "gas", null, { db }),
    ).toThrow(ValidationError);
    expect(() =>
      addCostLine(sheet.id, -1, "gas", null, { db }),
    ).toThrow(/cannot be negative/);
  });

  it("rejects float amounts with ValidationError (sen integer only)", () => {
    expect(() =>
      addCostLine(sheet.id, 12.34 as any, "gas", null, { db }),
    ).toThrow(/must be an integer/);
  });

  it("rejects amounts exceeding Number.MAX_SAFE_INTEGER with ValidationError", () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(() =>
      addCostLine(sheet.id, huge, "gas", null, { db }),
    ).toThrow(ValidationError);
    expect(() =>
      addCostLine(sheet.id, huge, "gas", null, { db }),
    ).toThrow(/exceeds maximum safe amount/);
  });

  it("enforces note rule when updating existing Cost Line to 'other'", () => {
    const line = addCostLine(sheet.id, 800n, "gas", null, { db });
    expect(() =>
      updateCostLine(line.id, { category: "other", note: "" }, { db }),
    ).toThrow(ValidationError);

    const updated = updateCostLine(
      line.id,
      { category: "other", note: "Gas cylinder deposit" },
      { db },
    );
    expect(updated.category).toBe("other");
    expect(updated.note).toBe("Gas cylinder deposit");
  });
});

describe("4. Sen integer arithmetic totals and correction trail", () => {
  it("computes exact integer totals using sumSen and subSen with no floats", () => {
    const sheet = getOrCreateSheet("2026-09-04", { db });

    // Set revenue: RM152.50 cash (15250 sen) + RM84.00 TnG (8400 sen)
    setRevenue(sheet.id, 15250, 8400, { db });

    // Add cost lines:
    // Restock: RM45.20 (4520 sen)
    // Gas: RM25.00 (2500 sen)
    // Transport: RM8.80 (880 sen)
    // Wages-daily: RM30.00 (3000 sen)
    addCostLine(sheet.id, 4520, "restock", null, { db });
    addCostLine(sheet.id, 2500, "gas", null, { db });
    addCostLine(sheet.id, 880, "transport", null, { db });
    addCostLine(sheet.id, 3000, "wages-daily", null, { db });

    const result = getSheetWithCosts("2026-09-04", { db });
    expect(result).not.toBeNull();
    expect(result!.costLines).toHaveLength(4);

    // 15250 + 8400 = 23650 sen
    expect(result!.totalRevenueSen).toBe(23650n);
    // 4520 + 2500 + 880 + 3000 = 10900 sen
    expect(result!.totalCostSen).toBe(10900n);
    // Gross Profit = 23650 - 10900 = 12750 sen
    expect(result!.grossProfitSen).toBe(12750n);
  });

  it("updates revenue and rejects negative or float revenues", () => {
    const sheet = getOrCreateSheet("2026-09-04", { db });

    expect(() => setRevenue(sheet.id, -100, 500, { db })).toThrow(
      ValidationError,
    );
    expect(() => setRevenue(sheet.id, 100.5 as any, 500, { db })).toThrow(
      /must be an integer/,
    );

    const updated = setRevenue(sheet.id, 20000, 10000, { db });
    expect(updated.cashSen).toBe(20000);
    expect(updated.tngSen).toBe(10000);
  });

  it("supports corrections on cost lines and maintains timestamp without hard deleting sheet", () => {
    const sheet = getOrCreateSheet("2026-09-05", { db });

    const line = addCostLine(sheet.id, 2000, "restock", null, { db });

    // Correction: update amount from 2000 to 2500
    const updatedLine = updateCostLine(
      line.id,
      { amountSen: 2500 },
      { db },
    );
    expect(updatedLine.amountSen).toBe(2500);

    const sheetAfterUpdate = db
      .select()
      .from(dailySheets)
      .where(eq(dailySheets.id, sheet.id))
      .get()!;
    expect(sheetAfterUpdate.updatedAt).toBeDefined();

    // Correction: remove cost line
    const removeResult = removeCostLine(line.id, { db });
    expect(removeResult.success).toBe(true);
    expect(removeResult.removedLine.id).toBe(line.id);

    // Sheet still exists (no hard delete of sheet!)
    const sheetAfterDelete = db
      .select()
      .from(dailySheets)
      .where(eq(dailySheets.id, sheet.id))
      .get();
    expect(sheetAfterDelete).not.toBeNull();
    expect(sheetAfterDelete?.date).toBe("2026-09-05");

    const withCosts = getSheetWithCosts("2026-09-05", { db });
    expect(withCosts?.costLines).toHaveLength(0);
    expect(withCosts?.totalCostSen).toBe(0n);
  });
});

describe("5. Closed-month edit rejection", () => {
  beforeAll(() => {
    // Create the historical rows before Month Close locks the month
    const historicalSheet = db.insert(dailySheets)
      .values({
        date: "2026-07-15",
        cashSen: 1000,
        tngSen: 500,
      })
      .returning().get()!;
    db.insert(costLines).values({ dailySheetId: historicalSheet.id, amountSen: 1500, category: "gas" }).run();

    // Manually record a closed month for 2026-07
    db.insert(monthCloses)
      .values({
        month: "2026-07",
        revenueSen: 500000,
        dailyCostSen: 200000,
        grossSen: 300000,
        operatingSen: 100000,
        netSen: 200000,
        closedAt: "2026-08-01T00:00:00.000Z",
        reopenedAt: null,
      })
      .run();

  });

  it("rejects creating a new Daily Sheet in a closed month", () => {
    expect(() => getOrCreateSheet("2026-07-20", { db })).toThrow(
      ClosedMonthError,
    );
    expect(() => getOrCreateSheet("2026-07-20", { db })).toThrow(
      /closed and cannot be edited/,
    );
  });

  it("rejects revenue edits for a Daily Sheet in a closed month", () => {
    const existing = db
      .select()
      .from(dailySheets)
      .where(eq(dailySheets.date, "2026-07-15"))
      .get()!;

    expect(() =>
      setRevenue(existing.id, 2000, 1000, { db }),
    ).toThrow(ClosedMonthError);
  });

  it("rejects adding, updating, or removing cost lines in a closed month", () => {
    const existing = db
      .select()
      .from(dailySheets)
      .where(eq(dailySheets.date, "2026-07-15"))
      .get()!;

    // This Cost Line was recorded before Month Close.
    const insertedLine = db.select().from(costLines)
      .where(eq(costLines.dailySheetId, existing.id)).get()!;

    // Adding cost line rejected
    expect(() =>
      addCostLine(existing.id, 500, "restock", null, { db }),
    ).toThrow(ClosedMonthError);

    // Updating cost line rejected
    expect(() =>
      updateCostLine(insertedLine.id, { amountSen: 1600 }, { db }),
    ).toThrow(ClosedMonthError);

    // Removing cost line rejected
    expect(() => removeCostLine(insertedLine.id, { db })).toThrow(
      ClosedMonthError,
    );
  });

  it("allows reading sheets from a closed month", () => {
    const result = getSheetWithCosts("2026-07-15", { db });
    expect(result).not.toBeNull();
    expect(result!.sheet.date).toBe("2026-07-15");
  });

  it("allows edits once an Admin reopens a closed month", () => {
    // Mark 2026-07 as reopened
    db.update(monthCloses)
      .set({
        reopenedAt: "2026-08-05T00:00:00.000Z",
        reopenReason: "Admin correction for gas expense",
      })
      .where(eq(monthCloses.month, "2026-07"))
      .run();

    const existing = db
      .select()
      .from(dailySheets)
      .where(eq(dailySheets.date, "2026-07-15"))
      .get()!;

    // Now edits should succeed
    const updated = setRevenue(existing.id, 3000, 1500, { db });
    expect(updated.cashSen).toBe(3000);

    const newLine = addCostLine(existing.id, 1200, "gas", null, { db });
    expect(newLine.amountSen).toBe(1200);
  });
});

describe("7. Idempotent cost line replacement and hardening (Option A)", () => {


  it("replaceCostLines() replaces lines idempotently and updates updatedAt trail", () => {
    const sheet = getOrCreateSheet("2026-09-02", { db });

    // 1. Initial replace with 2 cost lines
    const lines1 = replaceCostLines(
      sheet.id,
      [
        { amountSen: 2000, category: "gas" },
        { amountSen: 4000, category: "restock" },
      ],
      { db },
    );
    expect(lines1).toHaveLength(2);

    let rows = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, sheet.id))
      .all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.category).sort()).toEqual(["gas", "restock"]);

    // 2. Calling replaceCostLines again with the SAME 2 lines does not append duplicates
    const lines2 = replaceCostLines(
      sheet.id,
      [
        { amountSen: 2000, category: "gas" },
        { amountSen: 4000, category: "restock" },
      ],
      { db },
    );
    expect(lines2).toHaveLength(2);

    rows = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, sheet.id))
      .all();
    expect(rows).toHaveLength(2);

    // 3. Parent sheet still exists and has updatedAt timestamp set
    const parent = db
      .select()
      .from(dailySheets)
      .where(eq(dailySheets.id, sheet.id))
      .get()!;
    expect(parent).toBeDefined();
    expect(parent.updatedAt).toBeDefined();

    // 4. Replacing with empty array clears all cost lines
    const cleared = replaceCostLines(sheet.id, [], { db });
    expect(cleared).toHaveLength(0);
    rows = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, sheet.id))
      .all();
    expect(rows).toHaveLength(0);
  });

  it("replaceCostLines() enforces validation and rolls back on error", () => {
    const sheet = getOrCreateSheet("2026-09-02", { db });

    // Seed 1 valid cost line
    replaceCostLines(
      sheet.id,
      [{ amountSen: 1000, category: "gas" }],
      { db },
    );

    // Rejects non-array input
    expect(() =>
      replaceCostLines(sheet.id, "not-array" as any, { db }),
    ).toThrow(ValidationError);

    // Rejects non-object item in array
    expect(() =>
      replaceCostLines(sheet.id, [null as any], { db }),
    ).toThrow(ValidationError);

    // Rejects invalid category
    expect(() =>
      replaceCostLines(
        sheet.id,
        [{ amountSen: 1000, category: "invalid-cat" as any }],
        { db },
      ),
    ).toThrow(ValidationError);

    // Rejects 'other' without note
    expect(() =>
      replaceCostLines(
        sheet.id,
        [{ amountSen: 1000, category: "other", note: "   " }],
        { db },
      ),
    ).toThrow(ValidationError);

    // Rejects negative sen
    expect(() =>
      replaceCostLines(
        sheet.id,
        [{ amountSen: -500, category: "gas" }],
        { db },
      ),
    ).toThrow(ValidationError);

    // Rejects float sen
    expect(() =>
      replaceCostLines(
        sheet.id,
        [{ amountSen: 12.34 as any, category: "gas" }],
        { db },
      ),
    ).toThrow(ValidationError);

    // Atomicity: existing line was preserved because validation failed before mutation
    const rows = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, sheet.id))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].amountSen).toBe(1000);

    // Rejects nonexistent sheet
    expect(() =>
      replaceCostLines(999999, [{ amountSen: 1000, category: "gas" }], { db }),
    ).toThrow(NotFoundError);
  });

  it("replaceCostLines() rejects edits in a closed month", () => {
    const closedSheet = db
      .insert(dailySheets)
      .values({
        date: "2026-05-15",
        cashSen: 1000,
        tngSen: 500,
      })
      .returning()
      .get();

    // Record a closed month for 2026-05 with reopenedAt: null
    db.insert(monthCloses)
      .values({
        month: "2026-05",
        revenueSen: 500000,
        dailyCostSen: 200000,
        grossSen: 300000,
        operatingSen: 100000,
        netSen: 200000,
        closedAt: "2026-06-01T00:00:00.000Z",
        reopenedAt: null,
      })
      .run();

    expect(() =>
      replaceCostLines(
        closedSheet.id,
        [{ amountSen: 500, category: "gas" }],
        { db },
      ),
    ).toThrow(ClosedMonthError);
  });
});

describe("8. Regression tests: duplicate lines & non-string note validation", () => {


  it("REGRESSION: replaceCostLines merges same category+note rows, treating null and empty/whitespace notes as equivalent", () => {
    const sheet = getOrCreateSheet("2026-09-09", { db });

    const lines = [
      // 3 restock lines with same note (with surrounding whitespace) -> merges to 1 row: 5000 sen
      { amountSen: 2000, category: "restock", note: "chicken" },
      { amountSen: 1500, category: "restock", note: " chicken " },
      { amountSen: 1500, category: "restock", note: "chicken" },

      // 3 gas lines with null, empty string, and whitespace note -> merges to 1 row with null note: 2000 sen
      { amountSen: 500, category: "gas", note: null },
      { amountSen: 700, category: "gas", note: "" },
      { amountSen: 800, category: "gas", note: "   " },

      // Distinct notes or categories remain separate
      { amountSen: 1200, category: "transport", note: "lalamove" },
      { amountSen: 300, category: "restock", note: "vegetables" },
    ];

    const replaced = replaceCostLines(sheet.id, lines, { db });

    expect(replaced).toHaveLength(4);

    const chickenRow = replaced.find((r) => r.category === "restock" && r.note === "chicken");
    expect(chickenRow).toBeDefined();
    expect(chickenRow?.amountSen).toBe(5000);

    const gasRow = replaced.find((r) => r.category === "gas" && r.note === null);
    expect(gasRow).toBeDefined();
    expect(gasRow?.amountSen).toBe(2000);

    const transportRow = replaced.find((r) => r.category === "transport" && r.note === "lalamove");
    expect(transportRow).toBeDefined();
    expect(transportRow?.amountSen).toBe(1200);

    const vegRow = replaced.find((r) => r.category === "restock" && r.note === "vegetables");
    expect(vegRow).toBeDefined();
    expect(vegRow?.amountSen).toBe(300);

    // Verify directly in DB
    const dbRows = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, sheet.id))
      .all();
    expect(dbRows).toHaveLength(4);

    // Total in sheet should match sum of all lines (8500 sen)
    const withCosts = getSheetWithCosts("2026-09-09", { db });
    expect(withCosts?.totalCostSen).toBe(8500n);
  });

  it("REGRESSION: replaceCostLines throws ValidationError if merged total exceeds Number.MAX_SAFE_INTEGER", () => {
    const sheet = getOrCreateSheet("2026-09-09", { db });
    const huge = BigInt(Number.MAX_SAFE_INTEGER) - 50n;
    expect(() =>
      replaceCostLines(
        sheet.id,
        [
          { amountSen: huge, category: "restock", note: "bulk" },
          { amountSen: 100n, category: "restock", note: "bulk" },
        ],
        { db },
      ),
    ).toThrow(ValidationError);
  });

  it("merged overflow is rejected with code invalidAmount, never saturated, and leaves saved lines untouched", () => {
    const sheet = getOrCreateSheet("2026-09-19", { db });
    replaceCostLines(sheet.id, [{ amountSen: 1200, category: "gas" }], { db });

    let caught: unknown;
    try {
      replaceCostLines(
        sheet.id,
        [
          { amountSen: 500, category: "transport" },
          { amountSen: Number.MAX_SAFE_INTEGER, category: "restock", note: "bulk" },
          { amountSen: 1, category: "restock", note: " bulk " },
        ],
        { db },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).code).toBe("invalidAmount");

    const rows = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, sheet.id))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("gas");
    expect(rows[0].amountSen).toBe(1200);

    // A merge landing exactly on the limit is still accepted
    const atLimit = replaceCostLines(
      sheet.id,
      [
        { amountSen: Number.MAX_SAFE_INTEGER - 1, category: "restock", note: "bulk" },
        { amountSen: 1, category: "restock", note: "bulk" },
      ],
      { db },
    );
    expect(atLimit).toHaveLength(1);
    expect(atLimit[0].amountSen).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("client consolidateCostLines and server replaceCostLines apply the same merge rule", () => {
    const sheet = getOrCreateSheet("2026-09-20", { db });
    // Same fixture as the form parity test in DailySheetForm.test.ts
    const lines = [
      { category: "restock" as const, amountSen: 2000, note: " rice " },
      { category: "gas" as const, amountSen: 700, note: null },
      { category: "restock" as const, amountSen: 3000, note: "rice" },
      { category: "gas" as const, amountSen: 300, note: "   " },
      { category: "other" as const, amountSen: 900, note: "rice" },
    ];

    const server = replaceCostLines(sheet.id, lines, { db }).map((l) => ({
      category: l.category,
      note: l.note,
      amountSen: l.amountSen,
    }));
    const client = consolidateCostLines(lines).map((l) => ({
      category: l.category,
      note: (l.note ?? "").trim() || null,
      amountSen: l.amountSen,
    }));

    expect(server).toEqual(client);
    expect(server).toEqual([
      { category: "restock", note: "rice", amountSen: 5000 },
      { category: "gas", note: null, amountSen: 1000 },
      { category: "other", note: "rice", amountSen: 900 },
    ]);
  });

  it("REGRESSION: replaceCostLines re-validates category and requires note for other on merged rows", () => {
    const sheet = getOrCreateSheet("2026-09-09", { db });
    expect(() =>
      replaceCostLines(
        sheet.id,
        [{ amountSen: 1000, category: "invalid_cat", note: "bad" }],
        { db },
      ),
    ).toThrow(ValidationError);

    expect(() =>
      replaceCostLines(
        sheet.id,
        [{ amountSen: 1000, category: "other", note: "" }],
        { db },
      ),
    ).toThrow(ValidationError);
  });

  it("REGRESSION: deleting a merged row drops the whole group of underlying records in DB", () => {
    const sheet = getOrCreateSheet("2026-09-09", { db });

    // Save with 2 restock rice rows and 1 gas row
    replaceCostLines(
      sheet.id,
      [
        { amountSen: 2000, category: "restock", note: "rice" },
        { amountSen: 3000, category: "restock", note: "rice" },
        { amountSen: 1500, category: "gas", note: null },
      ],
      { db },
    );

    let current = getSheetWithCosts("2026-09-09", { db });
    expect(current?.costLines).toHaveLength(2);

    // Delete the merged restock row by saving only the remaining gas row
    replaceCostLines(
      sheet.id,
      [{ amountSen: 1500, category: "gas", note: null }],
      { db },
    );

    current = getSheetWithCosts("2026-09-09", { db });
    expect(current?.costLines).toHaveLength(1);
    expect(current?.costLines[0].category).toBe("gas");

    const riceInDb = db
      .select()
      .from(costLines)
      .where(and(eq(costLines.dailySheetId, sheet.id), eq(costLines.category, "restock")))
      .all();
    expect(riceInDb).toHaveLength(0);
  });
});

describe("10. Zero-amount Cost Lines rejected server-side (policy 2026-09-25)", () => {
  it("replaceCostLines() rejects a zero-amount line and leaves existing lines untouched", () => {
    const sheet = getOrCreateSheet("2026-09-11", { db });

    // Seed 1 valid cost line
    replaceCostLines(sheet.id, [{ amountSen: 1500, category: "gas" }], { db });

    // Zero amount is rejected (bigint, number, and numeric-string forms)
    expect(() =>
      replaceCostLines(sheet.id, [{ amountSen: 0, category: "gas" }], { db }),
    ).toThrow(ValidationError);

    expect(() =>
      replaceCostLines(sheet.id, [{ amountSen: 0n, category: "gas" }], { db }),
    ).toThrow(ValidationError);

    expect(() =>
      replaceCostLines(
        sheet.id,
        [{ amountSen: "0" as any, category: "gas" }],
        { db },
      ),
    ).toThrow(ValidationError);

    // A zero line mixed in with valid lines fails the whole call
    expect(() =>
      replaceCostLines(
        sheet.id,
        [
          { amountSen: 2000, category: "restock" },
          { amountSen: 0, category: "transport" },
        ],
        { db },
      ),
    ).toThrow(ValidationError);

    // Two zero lines that would merge into a zero row are also rejected
    expect(() =>
      replaceCostLines(
        sheet.id,
        [
          { amountSen: 0, category: "gas" },
          { amountSen: 0, category: "gas" },
        ],
        { db },
      ),
    ).toThrow(ValidationError);

    // Atomicity: the seeded line survived, nothing was deleted or inserted
    const rows = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, sheet.id))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].amountSen).toBe(1500);
    expect(rows[0].category).toBe("gas");
  });

  it("validation error names the Cost Category, the note, and the zero amount", () => {
    const sheet = getOrCreateSheet("2026-09-11", { db });

    expect(() =>
      replaceCostLines(
        sheet.id,
        [{ amountSen: 0, category: "other", note: "Free sample" }],
        { db },
      ),
    ).toThrow(/must be greater than 0.*"other" \("Free sample"\).*received: 0/);

    expect(() =>
      replaceCostLines(sheet.id, [{ amountSen: 0, category: "gas" }], { db }),
    ).toThrow(/must be greater than 0.*"gas".*received: 0/);
  });

  it("replaceCostLines() still accepts an empty array (no lines is fine) and positive lines", () => {
    const sheet = getOrCreateSheet("2026-09-12", { db });

    // Positive lines are written normally
    const inserted = replaceCostLines(
      sheet.id,
      [
        { amountSen: 1, category: "gas" },
        { amountSen: 4520, category: "restock", note: "  rice  " },
      ],
      { db },
    );
    expect(inserted).toHaveLength(2);
    expect(inserted.map((l) => l.amountSen).sort((a, b) => a - b)).toEqual([
      1, 4520,
    ]);
    expect(inserted.find((l) => l.category === "restock")!.note).toBe("rice");

    // Empty array clears the lines without throwing
    const cleared = replaceCostLines(sheet.id, [], { db });
    expect(cleared).toHaveLength(0);
    const rows = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, sheet.id))
      .all();
    expect(rows).toHaveLength(0);
  });

  it("addCostLine() rejects a zero amount but still accepts positive amounts", () => {
    const sheet = getOrCreateSheet("2026-09-12", { db });

    expect(() => addCostLine(sheet.id, 0, "gas", null, { db })).toThrow(
      ValidationError,
    );
    expect(() => addCostLine(sheet.id, 0n, "gas", null, { db })).toThrow(
      ValidationError,
    );

    const line = addCostLine(sheet.id, 700, "gas", null, { db });
    expect(line.amountSen).toBe(700);
  });

  it("updateCostLine() rejects an update that would set the amount to zero", () => {
    const sheet = getOrCreateSheet("2026-09-12", { db });
    const line = addCostLine(sheet.id, 2500, "restock", null, { db });

    expect(() =>
      updateCostLine(line.id, { amountSen: 0 }, { db }),
    ).toThrow(ValidationError);

    expect(() =>
      updateCostLine(line.id, { amountSen: 0n }, { db }),
    ).toThrow(ValidationError);

    // Row is unchanged after the rejected update
    const unchanged = db
      .select()
      .from(costLines)
      .where(eq(costLines.id, line.id))
      .get()!;
    expect(unchanged.amountSen).toBe(2500);

    // A positive correction still goes through
    const corrected = updateCostLine(line.id, { amountSen: 2600 }, { db });
    expect(corrected.amountSen).toBe(2600);
  });

  it("Revenue of 0 stays legal (assertValidSen is NOT tightened)", () => {
    const sheet = getOrCreateSheet("2026-09-12", { db });

    const zeroed = setRevenue(sheet.id, 0, 0, { db });
    expect(zeroed.cashSen).toBe(0);
    expect(zeroed.tngSen).toBe(0);

    const cashOnly = setRevenue(sheet.id, 15000, 0, { db });
    expect(cashOnly.cashSen).toBe(15000);
    expect(cashOnly.tngSen).toBe(0);
  });
});

describe("11. deleteSheet() and DELETE /api/sheets", () => {


  // The stored sheet's current identity, as the client would send it
  function identityOf(sheetId: number) {
    const row = db.select().from(dailySheets).where(eq(dailySheets.id, sheetId)).get()!;
    return { id: row.id, updatedAt: row.updatedAt };
  }

  it("foreign keys are enforced on the getDb() connection the route uses (cascade precondition)", () => {
    expect(getDb().sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("removes the Daily Sheet and its Cost Lines (FK cascade fires)", () => {
    const sheet = getOrCreateSheet("2026-09-13", { db });
    setRevenue(sheet.id, 8000, 2000, { db });
    addCostLine(sheet.id, 1500, "restock", null, { db });
    addCostLine(sheet.id, 500, "gas", null, { db });

    // Succeeds when the expected id + updatedAt match the stored sheet
    const result = deleteSheet(sheet.id, identityOf(sheet.id), { db });
    expect(result.success).toBe(true);
    expect(result.deletedSheet.id).toBe(sheet.id);
    expect(result.deletedSheet.date).toBe("2026-09-13");

    expect(
      db.select().from(dailySheets).where(eq(dailySheets.id, sheet.id)).get(),
    ).toBeUndefined();
    expect(
      db.select().from(costLines).where(eq(costLines.dailySheetId, sheet.id)).all(),
    ).toHaveLength(0);
    expect(getSheetWithCosts("2026-09-13", { db })).toBeNull();
  });

  it("throws NotFoundError for a missing sheet id", () => {
    expect(() =>
      deleteSheet(999999, { id: 999999, updatedAt: "2026-09-01T00:00:00.000Z" }, { db }),
    ).toThrow(NotFoundError);
  });

  it("throws ConflictError when the sheet changed since the expected snapshot, deleting nothing", () => {
    const sheet = getOrCreateSheet("2026-09-16", { db });
    addCostLine(sheet.id, 700, "gas", null, { db });
    const stale = identityOf(sheet.id);

    // Another device saves the day after the Operator's snapshot loaded, on
    // the real clock, typically within the same millisecond (ADR 0006).
    setRevenue(sheet.id, 9900, 0, { db });
    expect(identityOf(sheet.id).updatedAt).not.toBe(stale.updatedAt);

    expect(() => deleteSheet(sheet.id, stale, { db })).toThrow(ConflictError);
    // A matching updatedAt on a different id is a conflict too
    expect(() =>
      deleteSheet(sheet.id, { ...identityOf(sheet.id), id: sheet.id + 1000 }, { db }),
    ).toThrow(ConflictError);

    expect(
      db.select().from(dailySheets).where(eq(dailySheets.id, sheet.id)).get(),
    ).toBeDefined();
    expect(
      db.select().from(costLines).where(eq(costLines.dailySheetId, sheet.id)).all(),
    ).toHaveLength(1);

    // With the current identity the same delete goes through
    expect(deleteSheet(sheet.id, identityOf(sheet.id), { db }).success).toBe(true);
    expect(getSheetWithCosts("2026-09-16", { db })).toBeNull();
  });

  it("throws ClosedMonthError in a closed Month and leaves the sheet and its Cost Lines intact", () => {
    const sheet = db
      .insert(dailySheets)
      .values({ date: "2026-06-10", cashSen: 1000, tngSen: 500 })
      .returning()
      .get();
    db.insert(costLines)
      .values({ dailySheetId: sheet.id, amountSen: 300, category: "gas" })
      .run();
    db.insert(monthCloses)
      .values({
        month: "2026-06",
        revenueSen: 1500,
        dailyCostSen: 300,
        grossSen: 1200,
        operatingSen: 0,
        netSen: 1200,
        closedAt: "2026-07-01T00:00:00.000Z",
        reopenedAt: null,
      })
      .run();

    expect(() => deleteSheet(sheet.id, identityOf(sheet.id), { db })).toThrow(
      ClosedMonthError,
    );

    expect(
      db.select().from(dailySheets).where(eq(dailySheets.id, sheet.id)).get(),
    ).toBeDefined();
    expect(
      db.select().from(costLines).where(eq(costLines.dailySheetId, sheet.id)).all(),
    ).toHaveLength(1);
  });
});

describe("12. Daily Sheet updatedAt is strictly monotonic (ADR 0006)", () => {
  const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  function storedUpdatedAt(sheetId: number): string {
    return db.select().from(dailySheets).where(eq(dailySheets.id, sheetId)).get()!
      .updatedAt;
  }

  function setStoredUpdatedAt(sheetId: number, value: string) {
    db.update(dailySheets)
      .set({ updatedAt: value })
      .where(eq(dailySheets.id, sheetId))
      .run();
  }

  // Every write path that touches daily_sheets.updated_at. Each gets its own
  // sheet (with Cost Lines for the paths that need them); a test calls write()
  // once or twice.
  const writePaths: Array<{ name: string; date: string; write: (sheetId: number) => void }> = [
    { name: "setRevenue", date: "2026-08-01", write: (id) => setRevenue(id, 1111, 22, { db }) },
    {
      name: "addCostLine",
      date: "2026-08-02",
      write: (id) => addCostLine(id, 300, "gas", null, { db }),
    },
    {
      name: "updateCostLine",
      date: "2026-08-03",
      write: (id) => {
        const line = db.select().from(costLines).where(eq(costLines.dailySheetId, id)).get()!;
        updateCostLine(line.id, { amountSen: line.amountSen + 1 }, { db });
      },
    },
    {
      name: "removeCostLine",
      date: "2026-08-04",
      write: (id) => {
        const line = db.select().from(costLines).where(eq(costLines.dailySheetId, id)).get()!;
        removeCostLine(line.id, { db });
      },
    },
    {
      name: "replaceCostLines",
      date: "2026-08-05",
      write: (id) =>
        replaceCostLines(id, [{ amountSen: 700, category: "restock" }], { db }),
    },
  ];

  function freshSheet(date: string): number {
    const sheet = getOrCreateSheet(date, { db });
    // Enough Cost Lines for two update/remove writes per test
    addCostLine(sheet.id, 100, "gas", null, { db });
    addCostLine(sheet.id, 200, "transport", null, { db });
    return sheet.id;
  }

  function resetSheet(date: string): number {
    const existing = getSheetWithCosts(date, { db });
    if (existing) {
      deleteSheet(
        existing.sheet.id,
        { id: existing.sheet.id, updatedAt: existing.sheet.updatedAt },
        { db },
      );
    }
    return freshSheet(date);
  }

  it.each(writePaths)(
    "$name: two writes in the same frozen millisecond yield distinct, strictly increasing updatedAt",
    ({ date, write }) => {
      const sheetId = resetSheet(date);
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const frozen = "2026-08-10T03:04:05.678Z";
        vi.setSystemTime(new Date(frozen));
        setStoredUpdatedAt(sheetId, "2026-08-10T03:04:05.000Z");

        write(sheetId);
        const first = storedUpdatedAt(sheetId);
        write(sheetId);
        const second = storedUpdatedAt(sheetId);

        // First write takes the (later) clock; second, same ms, goes 1 ms past it
        expect(first).toBe(frozen);
        expect(second).toBe("2026-08-10T03:04:05.679Z");
        expect(second > first).toBe(true);
        expect(second).toMatch(ISO_SHAPE);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(writePaths)(
    "$name: a clock earlier than the stored updatedAt still yields a strictly greater value",
    ({ date, write }) => {
      const sheetId = resetSheet(date);
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const stored = "2026-08-20T12:00:00.500Z";
        setStoredUpdatedAt(sheetId, stored);
        // Clock stepped back an hour (e.g. NTP correction)
        vi.setSystemTime(new Date("2026-08-20T11:00:00.000Z"));

        write(sheetId);
        const after = storedUpdatedAt(sheetId);

        expect(after).toBe("2026-08-20T12:00:00.501Z");
        expect(after > stored).toBe(true);
        expect(after).toMatch(ISO_SHAPE);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(writePaths)(
    "$name: a legacy CURRENT_TIMESTAMP updatedAt ends up strictly later, in ISO shape",
    ({ date, write }) => {
      const sheetId = resetSheet(date);
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        // Legacy shape is later in time than the clock, yet sorts before it as
        // raw text (space < "T"), so a raw string max would go backwards.
        const legacy = "2026-08-21 10:00:00";
        setStoredUpdatedAt(sheetId, legacy);
        vi.setSystemTime(new Date("2026-08-21T09:00:00.000Z"));

        write(sheetId);
        const after = storedUpdatedAt(sheetId);

        expect(after).toBe("2026-08-21T10:00:00.001Z");
        expect(after).toMatch(ISO_SHAPE);
        expect(Date.parse(after)).toBeGreaterThan(Date.parse(legacy.replace(" ", "T") + "Z"));
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("a freshly created sheet's legacy-shaped updatedAt is replaced by a strictly later ISO value on the first write", () => {
    // resetSheet() clears any leftover but adds Cost Lines (ISO updatedAt), so
    // drop its sheet and insert a bare one to get the schema default
    const cleanId = resetSheet("2026-08-22");
    deleteSheet(cleanId, { id: cleanId, updatedAt: storedUpdatedAt(cleanId) }, { db });
    const sheet = getOrCreateSheet("2026-08-22", { db });
    // Inserted via the schema default, i.e. SQLite's own CURRENT_TIMESTAMP
    expect(sheet.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const insertedAt = sheet.updatedAt.replace(" ", "T") + ".000Z";

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // Clock an hour behind the insert, so only the stored value can win
      vi.setSystemTime(new Date(Date.parse(insertedAt) - 3_600_000));

      const updated = setRevenue(sheet.id, 500, 0, { db });
      expect(updated.updatedAt).toBe(sheet.updatedAt.replace(" ", "T") + ".001Z");
      expect(updated.updatedAt).toMatch(ISO_SHAPE);
      expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(insertedAt));
    } finally {
      vi.useRealTimers();
    }
  });

  it("an unparseable updatedAt (hand-edited DB) falls back to the clock, then is strictly later again", () => {
    const sheetId = resetSheet("2026-08-24");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const frozen = "2026-08-24T05:06:07.890Z";
      vi.setSystemTime(new Date(frozen));
      setStoredUpdatedAt(sheetId, "garbage");

      // Documented fallback: the plain clock, not a crash and not NULL
      setRevenue(sheetId, 100, 0, { db });
      expect(storedUpdatedAt(sheetId)).toBe(frozen);

      // Guarantee is back on the very next write, same millisecond
      setRevenue(sheetId, 200, 0, { db });
      expect(storedUpdatedAt(sheetId)).toBe("2026-08-24T05:06:07.891Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("setRevenue returns the row carrying the new updatedAt", () => {
    const sheetId = resetSheet("2026-08-23");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-08-23T01:00:00.000Z"));
      setStoredUpdatedAt(sheetId, "2026-08-23T01:00:00.000Z");

      const returned = setRevenue(sheetId, 4200, 100, { db });
      expect(returned.updatedAt).toBe("2026-08-23T01:00:00.001Z");
      expect(returned.updatedAt).toBe(storedUpdatedAt(sheetId));
      expect(returned.cashSen).toBe(4200);
      expect(returned.tngSen).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });
});
