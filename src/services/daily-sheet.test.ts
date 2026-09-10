import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { openDb, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import {
  dailySheets,
  costLines,
  monthCloses,
  type DailySheet,
} from "@/db/schema";
import * as dailySheetService from "./daily-sheet";
import {
  addCostLine,
  assertValidNote,
  ClosedMonthError,
  FutureDateError,
  getOrCreateSheet,
  getSheetWithCosts,
  getTodayInKualaLumpur,
  isFutureDateInKL,
  NotFoundError,
  removeCostLine,
  replaceCostLines,
  setRevenue,
  updateCostLine,
  ValidationError,
} from "./daily-sheet";
import { GET as sheetsGet, POST as sheetsPost, PATCH as sheetsPatch } from "../../app/api/sheets/route";
import {
  POST as costLinesPost,
  PATCH as costLinesPatch,
  DELETE as costLinesDelete,
} from "../../app/api/sheets/cost-lines/route";

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
    // GET anonymous
    const getReq = new NextRequest("http://localhost:3000/api/sheets?date=2026-09-01");
    const getRes = await sheetsGet(getReq);
    expect(getRes.status).toBe(401);
    const getBody = await getRes.json();
    expect(getBody.error).toBe("Unauthorized");

    // POST anonymous
    const postReq = new NextRequest("http://localhost:3000/api/sheets", {
      method: "POST",
      body: JSON.stringify({ date: "2026-09-01" }),
    });
    const postRes = await sheetsPost(postReq);
    expect(postRes.status).toBe(401);

    // PATCH anonymous
    const patchReq = new NextRequest("http://localhost:3000/api/sheets", {
      method: "PATCH",
      body: JSON.stringify({ date: "2026-09-01", cashSen: 100, tngSen: 100 }),
    });
    const patchRes = await sheetsPatch(patchReq);
    expect(patchRes.status).toBe(401);

    // Cost-lines route anonymous
    const lineReq = new NextRequest("http://localhost:3000/api/sheets/cost-lines", {
      method: "POST",
      body: JSON.stringify({ sheetId: 1, amountSen: 100, category: "gas" }),
    });
    const lineRes = await costLinesPost(lineReq);
    expect(lineRes.status).toBe(401);

    // Cost-lines DELETE anonymous
    const deleteReq = new NextRequest("http://localhost:3000/api/sheets/cost-lines?id=1", {
      method: "DELETE",
    });
    const deleteRes = await costLinesDelete(deleteReq);
    expect(deleteRes.status).toBe(401);
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

    // 2. GET /api/sheets?date=2026-09-06
    const getReq = makeAuthReq("http://localhost:3000/api/sheets?date=2026-09-06");
    const getRes = await sheetsGet(getReq);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.sheet.date).toBe("2026-09-06");
    expect(getData.costLines).toHaveLength(2);

    // 3. PATCH /api/sheets to update revenue
    const patchReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-06",
        cashSen: 12000,
        tngSen: 6000,
      }),
    });
    const patchRes = await sheetsPatch(patchReq);
    expect(patchRes.status).toBe(200);
    const patchData = await patchRes.json();
    expect(patchData.totalRevenueSen).toBe(18000);

    // 4. Input validation: invalid date returns 400 with clear message
    const badDateReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "not-a-date" }),
    });
    const badDateRes = await sheetsPost(badDateReq);
    expect(badDateRes.status).toBe(400);
    const badDateBody = await badDateRes.json();
    expect(badDateBody.error).toMatch(/Invalid date format/);

    // 5. Input validation: missing note for 'other' returns 400
    const badOtherReq = makeAuthReq("http://localhost:3000/api/sheets/cost-lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheetId: postData.sheet.id,
        amountSen: 500,
        category: "other",
      }),
    });
    const badOtherRes = await costLinesPost(badOtherReq);
    expect(badOtherRes.status).toBe(400);
    const badOtherBody = await badOtherRes.json();
    expect(badOtherBody.error).toMatch(/Note is required when Cost Category is 'other'/);

    // 6. Delete cost line via DELETE /api/sheets/cost-lines?id=...
    const firstLineId = postData.costLines[0].id;
    const deleteReq = makeAuthReq(
      `http://localhost:3000/api/sheets/cost-lines?id=${firstLineId}`,
      { method: "DELETE" },
    );
    const deleteRes = await costLinesDelete(deleteReq);
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.success).toBe(true);

    // 7. Verify DELETE /api/sheets returns 405 (no hard delete of sheet)
    const delSheetReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "DELETE",
    });
    const delSheetRes = await sheetsPatch(delSheetReq);
    // GET verifies sheet still exists
    const verifyGetReq = makeAuthReq("http://localhost:3000/api/sheets?date=2026-09-06");
    const verifyGetRes = await sheetsGet(verifyGetReq);
    expect(verifyGetRes.status).toBe(200);
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

  it("hardening: direct-insert stays append-only single-line add and sheet-save cannot trigger it accidentally", async () => {
    const sheet = getOrCreateSheet("2026-09-07", { db });

    // Sheet currently has 2 lines from the previous test
    let currentLines = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, sheet.id))
      .all();
    expect(currentLines).toHaveLength(2);

    // 1. Direct-insert with action: "addCostLine" appends a single line
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
    expect(directActionRes.status).toBe(201);
    const directActionData = await directActionRes.json();
    expect(directActionData.costLine.category).toBe("transport");
    expect(directActionData.costLine.amountSen).toBe(500);

    // Now 3 lines
    currentLines = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, sheet.id))
      .all();
    expect(currentLines).toHaveLength(3);

    // 2. Direct-insert with sheetId + category + amountSen (no date, no costLines) appends a single line
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
    expect(directFieldsRes.status).toBe(201);
    const directFieldsData = await directFieldsRes.json();
    expect(directFieldsData.costLine.category).toBe("wages-daily");
    expect(directFieldsData.costLine.amountSen).toBe(1200);

    // Now 4 lines
    currentLines = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, sheet.id))
      .all();
    expect(currentLines).toHaveLength(4);

    // 3. Sheet-save flow with date + costLines + extraneous sheetId does NOT trigger direct-insert;
    // it replaces costLines with the provided array
    const sheetSaveWithSheetIdReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-07",
        sheetId: sheet.id,
        costLines: [
          { amountSen: 2500, category: "maintenance" },
        ],
      }),
    });
    const sheetSaveRes = await sheetsPost(sheetSaveWithSheetIdReq);
    expect(sheetSaveRes.status).toBe(201);
    const sheetSaveData = await sheetSaveRes.json();
    // It replaced the 4 lines with the 1 submitted line
    expect(sheetSaveData.costLines).toHaveLength(1);
    expect(sheetSaveData.costLines[0].category).toBe("maintenance");

    currentLines = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, sheet.id))
      .all();
    expect(currentLines).toHaveLength(1);

    // 4. Ambiguous body with both costLines array AND legacy single-line fields returns 400
    const ambiguousReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-07",
        category: "gas",
        amountSen: 9999,
        costLines: [
          { amountSen: 2500, category: "maintenance" },
        ],
      }),
    });
    const ambiguousRes = await sheetsPost(ambiguousReq);
    expect(ambiguousRes.status).toBe(400);
    const ambiguousData = await ambiguousRes.json();
    expect(ambiguousData.error).toMatch(/Ambiguous request body/);

    // 5. Idempotent legacy single-line save path: retrying the same payload does not duplicate rows
    const legacyPayload = {
      date: "2026-09-09",
      amountSen: 2000,
      category: "gas",
      note: "petronas",
    };
    const legacyFirstReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(legacyPayload),
    });
    const legacyFirstRes = await sheetsPost(legacyFirstReq);
    expect(legacyFirstRes.status).toBe(201);
    const legacyFirstData = await legacyFirstRes.json();
    expect(legacyFirstData.costLines).toHaveLength(1);

    const legacyRetryReq = makeAuthReq("http://localhost:3000/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(legacyPayload),
    });
    const legacyRetryRes = await sheetsPost(legacyRetryReq);
    expect(legacyRetryRes.status).toBe(201);
    const legacyRetryData = await legacyRetryRes.json();
    expect(legacyRetryData.costLines).toHaveLength(1);
    expect(legacyRetryData.costLines[0].id).toBe(legacyFirstData.costLines[0].id);
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

  it("REGRESSION: two same-category same-note lines survive save as 2 rows", async () => {
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
    expect(data.costLines).toHaveLength(2);
    expect(data.costLines[0].category).toBe("restock");
    expect(data.costLines[0].note).toBe("rice");
    expect(data.costLines[0].amountSen).toBe(1000);
    expect(data.costLines[1].category).toBe("restock");
    expect(data.costLines[1].note).toBe("rice");
    expect(data.costLines[1].amountSen).toBe(1000);

    const dbRows = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, data.sheet.id))
      .all();
    expect(dbRows).toHaveLength(2);
    expect(dbRows[0].id).not.toBe(dbRows[1].id);
    expect(dbRows[0].category).toBe("restock");
    expect(dbRows[0].note).toBe("rice");
    expect(dbRows[1].category).toBe("restock");
    expect(dbRows[1].note).toBe("rice");

    // Also verify replaceCostLines directly retains 2 distinct rows
    const replaced = replaceCostLines(
      data.sheet.id,
      [
        { amountSen: 1500, category: "gas", note: "shell" },
        { amountSen: 1500, category: "gas", note: "shell" },
      ],
      { db },
    );
    expect(replaced).toHaveLength(2);
    const dbReplaced = db
      .select()
      .from(costLines)
      .where(eq(costLines.dailySheetId, data.sheet.id))
      .all();
    expect(dbReplaced).toHaveLength(2);
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

    // 2. POST /api/sheets with single line containing non-string note: 123
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
    expect(postSingleBody.error).toMatch(/Note must be a string/);

    // 3. POST /api/sheets/cost-lines with note: 123
    const sheet = getOrCreateSheet("2026-09-08", { db });
    const postCostLineRouteReq = makeAuthReq("http://localhost:3000/api/sheets/cost-lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheetId: sheet.id,
        amountSen: 1000,
        category: "restock",
        note: 123,
      }),
    });
    const postCostLineRouteRes = await costLinesPost(postCostLineRouteReq);
    expect(postCostLineRouteRes.status).toBe(400);
    const postCostLineRouteBody = await postCostLineRouteRes.json();
    expect(postCostLineRouteBody.error).toMatch(/Note must be a string/);

    // 4. Direct service validations throw ValidationError (not TypeError)
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

    // 5. assertValidNote helper behavior
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
