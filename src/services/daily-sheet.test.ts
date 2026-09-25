import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";

import { openDb, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import {
  dailySheets,
  costLines,
  monthCloses,
  type DailySheet,
} from "@/db/schema";
import { getTodayInKualaLumpur, isFutureDateInKL } from "@/lib/datetime";
import * as dailySheetService from "./daily-sheet";
import {
  addCostLine,
  assertValidNote,
  getOrCreateSheet,
  getSheetWithCosts,
  removeCostLine,
  replaceCostLines,
  setRevenue,
  updateCostLine,
} from "./daily-sheet";
import {
  ClosedMonthError,
  FutureDateError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { POST as sheetsPost } from "../../app/api/sheets/route";

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

    // And create a pre-existing sheet in 2026-07 directly in db
    db.insert(dailySheets)
      .values({
        date: "2026-07-15",
        cashSen: 1000,
        tngSen: 500,
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

    // Directly insert a cost line in db to test update/delete
    const insertedLine = db
      .insert(costLines)
      .values({
        dailySheetId: existing.id,
        amountSen: 1500,
        category: "gas",
      })
      .returning()
      .get();

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

describe("6. API routes and auth guard protection (/api/sheets)", () => {
  it("rejects anonymous requests with 401 Unauthorized", async () => {
    // POST anonymous
    const postReq = new NextRequest("http://localhost:3000/api/sheets", {
      method: "POST",
      body: JSON.stringify({ date: "2026-09-01" }),
    });
    const postRes = await sheetsPost(postReq);
    expect(postRes.status).toBe(401);
    const postBody = await postRes.json();
    expect(postBody.error).toBe("Unauthorized");
  });

  it("performs end-to-end Daily Sheet lifecycle via API routes", async () => {
    const operatorSession = {
      user: { id: "1", username: "operator1", role: "Operator" as const },
      expires: new Date(Date.now() + 86400000).toISOString(),
    };

    function makeAuthReq(url: string, init?: any) {
      const req = new NextRequest(url, init as any);
      (req as any).auth = operatorSession;
      return req;
    }

    // 1. POST /api/sheets to create sheet with revenue and cost lines
    const postReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-06",
        cashSen: 10000,
        tngSen: 5000,
        costLines: [
          { amountSen: 3000, category: "restock" },
          { amountSen: 1500, category: "gas" },
        ],
      }),
    });

    const postRes = await sheetsPost(postReq);
    expect(postRes.status).toBe(201);
    const postData = await postRes.json();
    expect(postData.sheet.date).toBe("2026-09-06");
    expect(postData.totalRevenueSen).toBe(15000);
    expect(postData.totalCostSen).toBe(4500);
    expect(postData.grossProfitSen).toBe(10500);

    // 2. Re-saving the same date via POST updates revenue in place
    const resaveReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-06",
        cashSen: 12000,
        tngSen: 6000,
        costLines: [
          { amountSen: 3000, category: "restock" },
          { amountSen: 1500, category: "gas" },
        ],
      }),
    });
    const resaveRes = await sheetsPost(resaveReq);
    expect(resaveRes.status).toBe(201);
    const resaveData = await resaveRes.json();
    expect(resaveData.totalRevenueSen).toBe(18000);
    expect(resaveData.costLines).toHaveLength(2);

    // 2b. Revenue-only save (no costLines) is no longer accepted: costLines is required
    const revenueOnlyReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-06",
        cashSen: 13000,
        tngSen: 7000,
      }),
    });
    const revenueOnlyRes = await sheetsPost(revenueOnlyReq);
    expect(revenueOnlyRes.status).toBe(400);
    const revenueOnlyBody = await revenueOnlyRes.json();
    expect(revenueOnlyBody.error).toMatch(/'costLines' is required/);

    // Revenue must NOT have been touched by the rejected request
    const afterReject = getSheetWithCosts("2026-09-06", { db });
    expect(Number(afterReject!.totalRevenueSen)).toBe(18000);

    // 3. Input validation: invalid date returns 400 with clear message
    const badDateReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "not-a-date", costLines: [] }),
    });
    const badDateRes = await sheetsPost(badDateReq);
    expect(badDateRes.status).toBe(400);
    const badDateBody = await badDateRes.json();
    expect(badDateBody.error).toMatch(/Invalid date format/);

    // 4. Input validation: missing note for 'other' returns 400
    const badOtherReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-06",
        costLines: [{ amountSen: 500, category: "other" }],
      }),
    });
    const badOtherRes = await sheetsPost(badOtherReq);
    expect(badOtherRes.status).toBe(400);
    const badOtherBody = await badOtherRes.json();
    expect(badOtherBody.error).toMatch(/Note is required when Cost Category is 'other'/);
    expect(badOtherBody.code).toBe("otherNoteRequired");
  });
});

describe("7. Idempotent cost line replacement and hardening (Option A)", () => {
  const operatorSession = {
    user: { id: "1", username: "operator1", role: "Operator" as const },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };

  function makeAuthReq(url: string, init?: any) {
    const req = new NextRequest(url, init as any);
    (req as any).auth = operatorSession;
    return req;
  }

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

    const closedSheet = db
      .insert(dailySheets)
      .values({
        date: "2026-05-15",
        cashSen: 1000,
        tngSen: 500,
      })
      .returning()
      .get();

    expect(() =>
      replaceCostLines(
        closedSheet.id,
        [{ amountSen: 500, category: "gas" }],
        { db },
      ),
    ).toThrow(ClosedMonthError);
  });

  it("REGRESSION: saving the same sheet twice via POST /api/sheets with the same 2 cost lines results in exactly 2 rows", async () => {
    const savePayload = {
      date: "2026-09-07",
      cashSen: 8000,
      tngSen: 4000,
      costLines: [
        { amountSen: 3000, category: "restock" },
        { amountSen: 1500, category: "gas" },
      ],
    };

    // First save: creates sheet and inserts the 2 cost lines
    const firstReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(savePayload),
    });
    const firstRes = await sheetsPost(firstReq);
    expect(firstRes.status).toBe(201);
    const firstData = await firstRes.json();
    expect(firstData.sheet.date).toBe("2026-09-07");
    expect(firstData.costLines).toHaveLength(2);
    expect(firstData.totalCostSen).toBe(4500);

    // Check DB has exactly 2 rows
    let dbLines = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, firstData.sheet.id))
      .all();
    expect(dbLines).toHaveLength(2);

    // Second save: saving the SAME sheet with the SAME 2 cost lines
    const secondReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(savePayload),
    });
    const secondRes = await sheetsPost(secondReq);
    expect(secondRes.status).toBe(201);
    const secondData = await secondRes.json();
    expect(secondData.costLines).toHaveLength(2);
    expect(secondData.totalCostSen).toBe(4500);

    // Verifying regression fix: DB MUST have exactly 2 rows, NOT 4 rows
    dbLines = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, firstData.sheet.id))
      .all();
    expect(dbLines).toHaveLength(2);
  });

  it("retired legacy POST branches: direct-add and single-line shapes now return 400", async () => {
    const sheet = getOrCreateSheet("2026-09-07", { db });

    // Sheet currently has 2 lines from the previous test
    const linesFor = (sheetId: number) =>
      db.select().from(costLines).where(eq(costLines.dailySheetId, sheetId)).all();
    expect(linesFor(sheet.id)).toHaveLength(2);

    // 1. Direct-add via action: "addCostLine" is gone -> 400 (no 'date')
    const directActionReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "addCostLine",
        sheetId: sheet.id,
        category: "transport",
        amountSen: 500,
      }),
    });
    const directActionRes = await sheetsPost(directActionReq);
    expect(directActionRes.status).toBe(400);
    expect((await directActionRes.json()).error).toMatch(/'date' is required/);

    // 2. Direct-add via sheetId + category + amountSen (no date) is gone -> 400
    const directFieldsReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheetId: sheet.id,
        category: "wages-daily",
        amountSen: 1200,
      }),
    });
    const directFieldsRes = await sheetsPost(directFieldsReq);
    expect(directFieldsRes.status).toBe(400);
    expect((await directFieldsRes.json()).error).toMatch(/'date' is required/);

    // Neither rejected request wrote anything
    expect(linesFor(sheet.id)).toHaveLength(2);

    // 3. The sheet-save contract on its own still saves normally
    const sheetSaveReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-07",
        costLines: [
          { amountSen: 2500, category: "maintenance" },
        ],
      }),
    });
    const sheetSaveRes = await sheetsPost(sheetSaveReq);
    expect(sheetSaveRes.status).toBe(201);
    const sheetSaveData = await sheetSaveRes.json();
    // It replaced the 2 lines with the 1 submitted line
    expect(sheetSaveData.costLines).toHaveLength(1);
    expect(sheetSaveData.costLines[0].category).toBe("maintenance");
    expect(linesFor(sheet.id)).toHaveLength(1);

    // 4. Stray legacy fields alongside a valid costLines save are rejected, not
    // ignored: a client still sending them has a bug worth surfacing.
    for (const stray of [
      { sheetId: sheet.id },
      { category: "gas", amountSen: 9999 },
      { note: "petronas" },
      { action: "addCostLine" },
    ]) {
      const strayReq = makeAuthReq("http://localhost:3000/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: "2026-09-07",
          ...stray,
          costLines: [{ amountSen: 7777, category: "gas" }],
        }),
      });
      const strayRes = await sheetsPost(strayReq);
      expect(strayRes.status).toBe(400);
      const strayBody = await strayRes.json();
      expect(strayBody.error).toMatch(/Unexpected legacy field\(s\):/);
      for (const field of Object.keys(stray)) {
        expect(strayBody.error).toContain(field);
      }
    }

    // None of the rejected requests touched the saved line
    expect(linesFor(sheet.id)).toHaveLength(1);
    expect(linesFor(sheet.id)[0].category).toBe("maintenance");

    // 5. Legacy single-line save (date + amountSen + category, no costLines) -> 400
    const legacySingleReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-09",
        amountSen: 2000,
        category: "gas",
        note: "petronas",
      }),
    });
    const legacySingleRes = await sheetsPost(legacySingleReq);
    expect(legacySingleRes.status).toBe(400);
    expect((await legacySingleRes.json()).error).toMatch(/'costLines' is required/);

    // A rejected save must not have created the sheet for that date
    expect(
      db.select().from(dailySheets).where(eq(dailySheets.date, "2026-09-09")).all(),
    ).toHaveLength(0);

    // 6. A non-array costLines is rejected too
    const badCostLinesReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-09-07", costLines: "not-an-array" }),
    });
    const badCostLinesRes = await sheetsPost(badCostLinesReq);
    expect(badCostLinesRes.status).toBe(400);
    expect((await badCostLinesRes.json()).error).toMatch(/must be an array/);
  });
});

describe("8. Regression tests: duplicate lines & non-string note validation", () => {
  const operatorSession = {
    user: { id: "1", username: "operator1", role: "Operator" as const },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };

  function makeAuthReq(url: string, init?: any) {
    const req = new NextRequest(url, init as any);
    (req as any).auth = operatorSession;
    return req;
  }

  it("REGRESSION: duplicate same-category same-note lines merge into 1 row on save", async () => {
    const savePayload = {
      date: "2026-09-08",
      cashSen: 5000,
      tngSen: 2000,
      costLines: [
        { amountSen: 1000, category: "restock", note: "rice" },
        { amountSen: 1000, category: "restock", note: "rice" },
      ],
    };

    const res = await sheetsPost(
      makeAuthReq("http://localhost:3000/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(savePayload),
      }),
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.costLines).toHaveLength(1);
    expect(data.costLines[0].category).toBe("restock");
    expect(data.costLines[0].note).toBe("rice");
    expect(data.costLines[0].amountSen).toBe(2000);

    const dbRows = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, data.sheet.id))
      .all();
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0].category).toBe("restock");
    expect(dbRows[0].note).toBe("rice");
    expect(dbRows[0].amountSen).toBe(2000);

    // Also verify replaceCostLines directly merges duplicate rows
    const replaced = replaceCostLines(
      data.sheet.id,
      [
        { amountSen: 1500, category: "gas", note: "shell" },
        { amountSen: 1500, category: "gas", note: "shell" },
      ],
      { db },
    );
    expect(replaced).toHaveLength(1);
    expect(replaced[0].category).toBe("gas");
    expect(replaced[0].note).toBe("shell");
    expect(replaced[0].amountSen).toBe(3000);

    const dbReplaced = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, data.sheet.id))
      .all();
    expect(dbReplaced).toHaveLength(1);
    expect(dbReplaced[0].amountSen).toBe(3000);
  });

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

  it("REGRESSION: POST with note:123 returns 400", async () => {
    // 1. POST /api/sheets with costLines containing non-string note: 123
    const postCostLinesReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-08",
        costLines: [{ amountSen: 1000, category: "restock", note: 123 }],
      }),
    });
    const postCostLinesRes = await sheetsPost(postCostLinesReq);
    expect(postCostLinesRes.status).toBe(400);
    const postCostLinesBody = await postCostLinesRes.json();
    expect(postCostLinesBody.error).toMatch(/Note must be a string/);

    // 2. The legacy single-line shape is retired: rejected before note validation
    const postSingleReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-08",
        amountSen: 1000,
        category: "restock",
        note: 123,
      }),
    });
    const postSingleRes = await sheetsPost(postSingleReq);
    expect(postSingleRes.status).toBe(400);
    const postSingleBody = await postSingleRes.json();
    expect(postSingleBody.error).toMatch(/'costLines' is required/);

    // 3. Direct service validations throw ValidationError (not TypeError)
    const sheet = getOrCreateSheet("2026-09-08", { db });
    expect(() =>
      addCostLine(sheet.id, 1000, "restock", 123 as any, { db }),
    ).toThrow(ValidationError);

    expect(() =>
      replaceCostLines(
        sheet.id,
        [{ amountSen: 1000, category: "restock", note: 123 as any }],
        { db },
      ),
    ).toThrow(ValidationError);

    const validLine = addCostLine(sheet.id, 1000, "restock", "valid", { db });
    expect(() =>
      updateCostLine(validLine.id, { note: 123 as any }, { db }),
    ).toThrow(ValidationError);

    // 4. assertValidNote helper behavior
    expect(assertValidNote(undefined)).toBeNull();
    expect(assertValidNote(null)).toBeNull();
    expect(assertValidNote("   ")).toBeNull();
    expect(assertValidNote("  rice  ")).toBe("rice");
    expect(() => assertValidNote(123)).toThrow(ValidationError);
    expect(() => assertValidNote({})).toThrow(ValidationError);
    expect(() => assertValidNote(true)).toThrow(ValidationError);
  });
});

describe("9. Pre-merge review: all-or-nothing atomicity and pre-validation in POST /api/sheets", () => {
  const operatorSession = {
    user: { id: "1", username: "operator1", role: "Operator" as const },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };

  function makeAuthReq(url: string, init?: any) {
    const req = new NextRequest(url, init as any);
    (req as any).auth = operatorSession;
    return req;
  }

  it("validates costLines fully BEFORE setRevenue so prior revenue is not mutated on invalid cost lines", async () => {
    const testDate = "2026-09-02";
    const sheet = getOrCreateSheet(testDate, { db });
    setRevenue(sheet.id, 5000, 3000, { db });

    // Verify initial revenue
    const initial = getOrCreateSheet(testDate, { db });
    expect(initial.cashSen).toBe(5000);
    expect(initial.tngSen).toBe(3000);

    // POST with new revenue but invalid costLines (negative amount)
    const req = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: testDate,
        cashSen: 99999,
        tngSen: 88888,
        costLines: [{ amountSen: -500, category: "gas" }],
      }),
    });

    const res = await sheetsPost(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cannot be negative/);

    // Verify revenue was NOT mutated
    const after = getOrCreateSheet(testDate, { db });
    expect(after.cashSen).toBe(5000);
    expect(after.tngSen).toBe(3000);
  });

  it("rolls back revenue updates when replaceCostLines fails mid-POST (revenue must NOT persist)", async () => {
    const testDate = "2026-09-03";
    const sheet = getOrCreateSheet(testDate, { db });
    setRevenue(sheet.id, 4000, 2000, { db });
    replaceCostLines(
      sheet.id,
      [{ amountSen: 1500, category: "transport", note: "grab" }],
      { db },
    );

    // Spy on dailySheetService.replaceCostLines to throw mid-POST
    const replaceSpy = vi
      .spyOn(dailySheetService, "replaceCostLines")
      .mockImplementationOnce(() => {
        throw new Error("Simulated failure in replaceCostLines mid-POST");
      });

    const req = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: testDate,
        cashSen: 90000,
        tngSen: 70000,
        costLines: [{ amountSen: 3000, category: "gas" }],
      }),
    });

    const res = await sheetsPost(req);
    expect(res.status).toBe(500);

    replaceSpy.mockRestore();

    // REGRESSION ASSERTION: Revenue must NOT persist (sheet keeps prior revenue)
    const currentSheet = getOrCreateSheet(testDate, { db });
    expect(currentSheet.cashSen).toBe(4000);
    expect(currentSheet.tngSen).toBe(2000);

    // Cost lines must also remain intact
    const currentCosts = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, sheet.id))
      .all();
    expect(currentCosts).toHaveLength(1);
    expect(currentCosts[0].category).toBe("transport");
    expect(currentCosts[0].amountSen).toBe(1500);
  });

  it("rolls back revenue updates when replaceCostLines throws ClosedMonthError mid-POST", async () => {
    const testDate = "2026-09-04";
    const sheet = getOrCreateSheet(testDate, { db });
    setRevenue(sheet.id, 1200, 800, { db });

    // Spy on dailySheetService.replaceCostLines to simulate a ClosedMonthError mid-POST
    const replaceSpy = vi
      .spyOn(dailySheetService, "replaceCostLines")
      .mockImplementationOnce(() => {
        throw new ClosedMonthError("Month is closed and cannot be edited");
      });

    const req = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: testDate,
        cashSen: 88888,
        tngSen: 99999,
        costLines: [{ amountSen: 500, category: "restock" }],
      }),
    });

    const res = await sheetsPost(req);
    expect(res.status).toBe(409);

    replaceSpy.mockRestore();

    // Revenue must not persist
    const currentSheet = getOrCreateSheet(testDate, { db });
    expect(currentSheet.cashSen).toBe(1200);
    expect(currentSheet.tngSen).toBe(800);
  });

  it("rolls back revenue updates when replaceCostLines throws NotFoundError mid-POST", async () => {
    const testDate = "2026-09-05";
    const sheet = getOrCreateSheet(testDate, { db });
    setRevenue(sheet.id, 6500, 3500, { db });

    // Spy on dailySheetService.replaceCostLines to throw NotFoundError
    const replaceSpy = vi
      .spyOn(dailySheetService, "replaceCostLines")
      .mockImplementationOnce(() => {
        throw new NotFoundError("Daily Sheet not found");
      });

    const req = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: testDate,
        cashSen: 77777,
        tngSen: 66666,
        costLines: [{ amountSen: 1000, category: "maintenance" }],
      }),
    });

    const res = await sheetsPost(req);
    expect(res.status).toBe(404);

    replaceSpy.mockRestore();

    // Prior revenue retained
    const currentSheet = getOrCreateSheet(testDate, { db });
    expect(currentSheet.cashSen).toBe(6500);
    expect(currentSheet.tngSen).toBe(3500);
  });

  it("rolls back getOrCreateSheet when replaceCostLines fails on a new date (leaves NO daily_sheets row)", async () => {
    const newDate = "2026-09-10";

    // Ensure no sheet exists yet for this date
    const beforeSheets = db
      .select()
      .from(dailySheets)
      .where(eq(dailySheets.date, newDate))
      .all();
    expect(beforeSheets).toHaveLength(0);

    // Spy on dailySheetService.replaceCostLines to throw mid-POST
    const replaceSpy = vi
      .spyOn(dailySheetService, "replaceCostLines")
      .mockImplementationOnce(() => {
        throw new Error("Simulated failure in replaceCostLines on new date");
      });

    const req = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: newDate,
        cashSen: 50000,
        tngSen: 30000,
        costLines: [{ amountSen: 1000, category: "gas" }],
      }),
    });

    const res = await sheetsPost(req);
    expect(res.status).toBe(500);

    replaceSpy.mockRestore();

    // REGRESSION ASSERTION: Daily sheet row must NOT exist (no orphan record)
    const afterSheets = db
      .select()
      .from(dailySheets)
      .where(eq(dailySheets.date, newDate))
      .all();
    expect(afterSheets).toHaveLength(0);
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
