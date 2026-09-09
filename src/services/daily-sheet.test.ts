import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import {
  addCostLine,
  ClosedMonthError,
  FutureDateError,
  getOrCreateSheet,
  getSheetWithCosts,
  getTodayInKualaLumpur,
  isFutureDateInKL,
  NotFoundError,
  removeCostLine,
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
