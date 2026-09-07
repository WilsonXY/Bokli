import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { openDb, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { monthCloses } from "@/db/schema";
import {
  addCostLine,
  ClosedMonthError,
  FutureDateError,
  getOrCreateSheet,
  getSheetWithCosts,
  NotFoundError,
  removeCostLine,
  setRevenue,
  updateCostLine,
  ValidationError,
} from "./daily-sheet";
import {
  addOperatingExpense,
  removeOperatingExpense,
  updateOperatingExpense,
} from "./operating-expense";
import {
  closeMonth,
  ForbiddenError,
  getClose,
  listCloses,
  reopenMonth,
} from "./month-close";
import { GET as closeGet, POST as closePost } from "../../app/api/close/route";
import { POST as reopenPost } from "../../app/api/close/reopen/route";

let tmpDir: string;
let dbPath: string;
let db: Db;
let sqlite: import("better-sqlite3").Database;
const originalDbPath = process.env.BOKLI_DB_PATH;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-month-close-test-"));
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

describe("1. Snapshot math vs known fixtures", () => {
  const MONTH = "2025-01";
  const MOCK_NOW = new Date("2025-01-31T12:00:00Z");

  it("accurately snapshots revenue, daily costs, gross profit, operating expenses, and net profit in integer sen", async () => {
    // Day 1 (2025-01-10): Cash RM350 (35000 sen), TnG RM200 (20000 sen) => Rev = 55000 sen
    const sheet1 = await getOrCreateSheet(`${MONTH}-10`, { db, now: MOCK_NOW });
    await setRevenue(sheet1.id, 35000, 20000, { db });
    await addCostLine(sheet1.id, 10000, "restock", "Morning vegetables", { db });
    await addCostLine(sheet1.id, 3500, "gas", null, { db });
    // Day 1 costs = 13500 sen

    // Day 2 (2025-01-11): Cash RM420.50 (42050 sen), TnG RM150 (15000 sen) => Rev = 57050 sen
    const sheet2 = await getOrCreateSheet(`${MONTH}-11`, { db, now: MOCK_NOW });
    await setRevenue(sheet2.id, 42050, 15000, { db });
    await addCostLine(sheet2.id, 12000, "restock", "Meat restock", { db });
    await addCostLine(sheet2.id, 2500, "transport", null, { db });
    await addCostLine(sheet2.id, 1500, "other", "Cleaning detergent", { db });
    // Day 2 costs = 16000 sen

    // Day 3 (2025-01-12): Cash RM500 (50000 sen), TnG RM300 (30000 sen) => Rev = 80000 sen
    const sheet3 = await getOrCreateSheet(`${MONTH}-12`, { db, now: MOCK_NOW });
    await setRevenue(sheet3.id, 50000, 30000, { db });
    await addCostLine(sheet3.id, 8000, "wages-daily", "Part-time helper", { db });
    // Day 3 costs = 8000 sen

    // Total Revenue = 55000 + 57050 + 80000 = 192050 sen
    // Total Daily Costs = 13500 + 16000 + 8000 = 37500 sen
    // Gross Profit = 192050 - 37500 = 154550 sen

    // Monthly Operating Expenses:
    // Rental: RM600 (60000 sen)
    await addOperatingExpense(MONTH, "rental", 60000, "Stall rent Jan", { db });
    // Utilities: RM180 (18000 sen)
    await addOperatingExpense(MONTH, "utilities", 18000, "Water and electricity", { db });
    // Wages: RM400 (40000 sen)
    await addOperatingExpense(MONTH, "wages", 40000, "Monthly helper", { db });
    // Total Operating Expenses = 60000 + 18000 + 40000 = 118000 sen

    // Expected Net Profit = 154550 - 118000 = 36550 sen
    // Reconciliation actual on hand: Cash RM200 (20000 sen) + TnG RM165.50 (16550 sen) = 36550 sen
    const closeRes = await closeMonth(MONTH, 20000, 16550, null, {
      db,
      now: MOCK_NOW,
    });

    expect(closeRes.month).toBe(MONTH);
    expect(closeRes.revenueSen).toBe(192050);
    expect(closeRes.dailyCostSen).toBe(37500);
    expect(closeRes.grossSen).toBe(154550);
    expect(closeRes.operatingSen).toBe(118000);
    expect(closeRes.netSen).toBe(36550);
    expect(closeRes.cashOnHandSen).toBe(20000);
    expect(closeRes.tngOnHandSen).toBe(16550);
    expect(closeRes.note).toBeNull();
    expect(closeRes.balanced).toBe(true);
    expect(closeRes.differenceSen).toBe(0n);
    expect(closeRes.reopenedAt).toBeNull();
    expect(closeRes.reopenReason).toBeNull();
    expect(closeRes.closedAt).toBeDefined();

    // Verify retrieval from DB
    const fetched = await getClose(MONTH, { db });
    expect(fetched).not.toBeNull();
    expect(fetched?.netSen).toBe(36550);
    expect(fetched?.balanced).toBe(true);
    expect(fetched?.differenceSen).toBe(0n);
  });
});

describe("2. Reconciliation warn-only and note-required-on-mismatch", () => {
  const MONTH = "2025-02";
  const MOCK_NOW = new Date("2025-02-28T12:00:00Z");

  beforeAll(async () => {
    // Setup month with Net Profit = 50000 sen
    const sheet = await getOrCreateSheet(`${MONTH}-01`, { db, now: MOCK_NOW });
    await setRevenue(sheet.id, 60000, 10000, { db }); // 70000 rev
    await addCostLine(sheet.id, 10000, "restock", null, { db }); // 10000 daily cost -> 60000 gross
    await addOperatingExpense(MONTH, "rental", 10000, null, { db }); // 10000 opex -> 50000 net
  });

  it("requires a non-empty note when Reconciliation is mismatched", async () => {
    // Net profit = 50000 sen. Actual cash + TnG = 30000 + 15000 = 45000 sen (mismatch of -5000 sen)

    // 1. Without note -> throws ValidationError
    await expect(
      closeMonth(MONTH, 30000, 15000, undefined, { db, now: MOCK_NOW }),
    ).rejects.toThrow(ValidationError);

    // 2. With null note -> throws ValidationError
    await expect(
      closeMonth(MONTH, 30000, 15000, null, { db, now: MOCK_NOW }),
    ).rejects.toThrow(ValidationError);

    // 3. With whitespace note -> throws ValidationError
    await expect(
      closeMonth(MONTH, 30000, 15000, "   ", { db, now: MOCK_NOW }),
    ).rejects.toThrow(ValidationError);
  });

  it("warns only and does NOT block Month Close when note is provided on mismatch", async () => {
    // Actual = 30000 + 15000 = 45000 sen. Expected = 50000 sen. Difference = -5000 sen.
    const note = "Short RM50 due to cash float discrepancy at stall";
    const result = await closeMonth(MONTH, 30000, 15000, note, {
      db,
      now: MOCK_NOW,
    });

    expect(result.month).toBe(MONTH);
    expect(result.netSen).toBe(50000);
    expect(result.cashOnHandSen).toBe(30000);
    expect(result.tngOnHandSen).toBe(15000);
    expect(result.note).toBe(note);
    expect(result.balanced).toBe(false);
    expect(result.differenceSen).toBe(-5000n);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain("Reconciliation mismatch");
  });
});

describe("3. Unique close per month & Future month rejection", () => {
  const MOCK_NOW = new Date("2025-03-15T12:00:00Z"); // current month in KL is 2025-03

  it("rejects closing a month that is already closed (unique close per month)", async () => {
    // Month 2025-01 was closed earlier
    await expect(
      closeMonth("2025-01", 10000, 10000, null, { db, now: MOCK_NOW }),
    ).rejects.toThrow(ClosedMonthError);
  });

  it("rejects invalid month string formats", async () => {
    await expect(
      closeMonth("2025-1", 0, 0, null, { db, now: MOCK_NOW }),
    ).rejects.toThrow(ValidationError);

    await expect(
      closeMonth("2025-13", 0, 0, null, { db, now: MOCK_NOW }),
    ).rejects.toThrow(ValidationError);

    await expect(
      closeMonth("not-a-month", 0, 0, null, { db, now: MOCK_NOW }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects closing future months in Asia/Kuala_Lumpur", async () => {
    // Current month is 2025-03 relative to MOCK_NOW
    await expect(
      closeMonth("2025-04", 0, 0, null, { db, now: MOCK_NOW }),
    ).rejects.toThrow(FutureDateError);

    await expect(
      closeMonth("2026-01", 0, 0, null, { db, now: MOCK_NOW }),
    ).rejects.toThrow(FutureDateError);
  });
});

describe("4. confirmEmpty rule for closing empty months", () => {
  const EMPTY_MONTH = "2025-03";
  const MOCK_NOW = new Date("2025-03-20T12:00:00Z");

  it("rejects closing a month with zero Daily Sheets unless confirmEmpty is true", async () => {
    // Zero sheets in 2025-03 without confirmEmpty -> rejects
    await expect(
      closeMonth(EMPTY_MONTH, 0, 0, null, { db, now: MOCK_NOW }),
    ).rejects.toThrow(ValidationError);

    await expect(
      closeMonth(EMPTY_MONTH, 0, 0, null, {
        confirmEmpty: false,
        db,
        now: MOCK_NOW,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("allows closing an empty month when confirmEmpty is explicitly true (snapshot all zeros)", async () => {
    const result = await closeMonth(EMPTY_MONTH, 0, 0, null, {
      confirmEmpty: true,
      db,
      now: MOCK_NOW,
    });

    expect(result.month).toBe(EMPTY_MONTH);
    expect(result.revenueSen).toBe(0);
    expect(result.dailyCostSen).toBe(0);
    expect(result.grossSen).toBe(0);
    expect(result.operatingSen).toBe(0);
    expect(result.netSen).toBe(0);
    expect(result.balanced).toBe(true);
    expect(result.differenceSen).toBe(0n);
  });
});

describe("5. Reopen gating (Operator rejected with Forbidden, Admin allowed)", () => {
  const MONTH = "2025-01"; // Closed in test 1
  const MOCK_NOW = new Date("2025-02-05T12:00:00Z");

  it("rejects non-Admin / Operator attempting to reopen with ForbiddenError", async () => {
    await expect(
      reopenMonth(MONTH, "Need to add late restock", "Operator", {
        db,
        now: MOCK_NOW,
      }),
    ).rejects.toThrow(ForbiddenError);

    await expect(
      reopenMonth(MONTH, "Need to add late restock", {
        role: "Operator",
        db,
        now: MOCK_NOW,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("requires a non-empty reason to reopen", async () => {
    await expect(
      reopenMonth(MONTH, "", "Admin", { db, now: MOCK_NOW }),
    ).rejects.toThrow(ValidationError);

    await expect(
      reopenMonth(MONTH, "   ", "Admin", { db, now: MOCK_NOW }),
    ).rejects.toThrow(ValidationError);
  });

  it("allows Admin to reopen with reason and sets reopenedAt + reopenReason", async () => {
    const reason = "Correction for missing restock receipt";
    const reopened = await reopenMonth(MONTH, reason, "Admin", {
      db,
      now: MOCK_NOW,
    });

    expect(reopened.month).toBe(MONTH);
    expect(reopened.reopenedAt).toBe(MOCK_NOW.toISOString());
    expect(reopened.reopenReason).toBe(reason);

    // Verify getClose reflects the reopen
    const fetched = await getClose(MONTH, { db });
    expect(fetched?.reopenedAt).toBe(MOCK_NOW.toISOString());
    expect(fetched?.reopenReason).toBe(reason);
  });

  it("rejects reopening a month that is already open", async () => {
    await expect(
      reopenMonth(MONTH, "Second reopen attempt", "Admin", { db, now: MOCK_NOW }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects reopening a non-existent month close", async () => {
    await expect(
      reopenMonth("2024-01", "Does not exist", "Admin", { db, now: MOCK_NOW }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("6. Edits blocked while closed and allowed after reopen", () => {
  const MONTH = "2025-04";
  const MOCK_NOW = new Date("2025-04-30T12:00:00Z");

  it("enforces edit lock when closed and allows edits once reopened", async () => {
    // 1. Setup month with 1 sheet, 1 cost line, 1 opex
    const sheet = await getOrCreateSheet(`${MONTH}-01`, { db, now: MOCK_NOW });
    await setRevenue(sheet.id, 20000, 10000, { db });
    const costLine = await addCostLine(sheet.id, 5000, "gas", null, { db });
    const opex = await addOperatingExpense(MONTH, "rental", 10000, null, { db });

    // 2. Close month
    // Net profit = (30000 - 5000) - 10000 = 15000 sen
    await closeMonth(MONTH, 10000, 5000, null, { db, now: MOCK_NOW });

    // 3. Edits are BLOCKED while closed:
    // Create new sheet in closed month
    await expect(
      getOrCreateSheet(`${MONTH}-02`, { db, now: MOCK_NOW }),
    ).rejects.toThrow(ClosedMonthError);

    // Set revenue on existing sheet in closed month
    await expect(setRevenue(sheet.id, 30000, 10000, { db })).rejects.toThrow(
      ClosedMonthError,
    );

    // Add cost line in closed month
    await expect(
      addCostLine(sheet.id, 2000, "restock", null, { db }),
    ).rejects.toThrow(ClosedMonthError);

    // Update cost line in closed month
    await expect(
      updateCostLine(costLine.id, { amountSen: 6000 }, { db }),
    ).rejects.toThrow(ClosedMonthError);

    // Remove cost line in closed month
    await expect(removeCostLine(costLine.id, { db })).rejects.toThrow(
      ClosedMonthError,
    );

    // Add operating expense in closed month
    await expect(
      addOperatingExpense(MONTH, "utilities", 3000, null, { db }),
    ).rejects.toThrow(ClosedMonthError);

    // Update operating expense in closed month
    await expect(
      updateOperatingExpense(opex.id, { amountSen: 12000 }, { db }),
    ).rejects.toThrow(ClosedMonthError);

    // Remove operating expense in closed month
    await expect(removeOperatingExpense(opex.id, { db })).rejects.toThrow(
      ClosedMonthError,
    );

    // 4. Admin reopens month
    await reopenMonth(MONTH, "Late adjustment to utilities and gas", "Admin", {
      db,
      now: MOCK_NOW,
    });

    // 5. Edits are now ALLOWED after reopen:
    const sheet2 = await getOrCreateSheet(`${MONTH}-02`, { db, now: MOCK_NOW });
    expect(sheet2.date).toBe(`${MONTH}-02`);

    const updatedSheet = await setRevenue(sheet.id, 25000, 10000, { db });
    expect(updatedSheet.cashSen).toBe(25000);

    const newCost = await addCostLine(sheet.id, 2000, "transport", null, { db });
    expect(newCost.id).toBeDefined();

    const updatedCost = await updateCostLine(
      costLine.id,
      { amountSen: 5500 },
      { db },
    );
    expect(updatedCost.amountSen).toBe(5500);

    const removedCost = await removeCostLine(costLine.id, { db });
    expect(removedCost.success).toBe(true);

    const newOpex = await addOperatingExpense(MONTH, "utilities", 4000, null, {
      db,
    });
    expect(newOpex.id).toBeDefined();

    const updatedOpex = await updateOperatingExpense(
      opex.id,
      { amountSen: 11000 },
      { db },
    );
    expect(updatedOpex.amountSen).toBe(11000);

    const removedOpex = await removeOperatingExpense(opex.id, { db });
    expect(removedOpex.success).toBe(true);

    // 6. Re-closing the reopened month re-locks it with updated snapshot
    // Revenue: sheet1 (25000 + 10000) = 35000; sheet2 = 0 => Rev = 35000 sen
    // Costs: transport = 2000 sen => Cost = 2000 sen -> Gross = 33000 sen
    // Opex: utilities = 4000 sen => Net = 29000 sen
    const reclosed = await closeMonth(MONTH, 20000, 9000, null, {
      db,
      now: MOCK_NOW,
    });
    expect(reclosed.netSen).toBe(29000);
    expect(reclosed.reopenedAt).toBeNull();
    expect(reclosed.reopenReason).toBeNull();

    // Edits are locked again
    await expect(
      getOrCreateSheet(`${MONTH}-03`, { db, now: MOCK_NOW }),
    ).rejects.toThrow(ClosedMonthError);
  });
});

describe("7. getClose and listCloses query functions", () => {
  it("getClose returns null for unclosed month", async () => {
    const close = await getClose("2024-12", { db });
    expect(close).toBeNull();
  });

  it("listCloses returns history per month with diffs ordered descending", async () => {
    const list = await listCloses({ db });
    expect(list.length).toBeGreaterThanOrEqual(3);

    // Should be sorted descending by month
    for (let i = 0; i < list.length - 1; i++) {
      expect(list[i].month >= list[i + 1].month).toBe(true);
    }

    // Every item contains required fields
    for (const item of list) {
      expect(item.month).toBeDefined();
      expect(typeof item.netSen).toBe("number");
      expect(typeof item.balanced).toBe("boolean");
      expect(item.closedAt).toBeDefined();
      expect("reopenedAt" in item).toBe(true);
      expect(typeof item.differenceSen).toBe("bigint");
    }
  });
});

describe("8. API Routes (/api/close and /api/close/reopen)", () => {
  const operatorSession = {
    user: { id: "1", name: "mom", role: "Operator" as const },
  };
  const adminSession = {
    user: { id: "2", name: "katte", role: "Admin" as const },
  };

  function makeAuthReq(url: string, session: any, init?: any) {
    const req = new NextRequest(url, init);
    (req as any).auth = session;
    return req;
  }

  it("rejects unauthenticated requests with 401 Unauthorized", async () => {
    // GET /api/close anonymous
    const getRes = await closeGet(new NextRequest("http://localhost:3000/api/close"));
    expect(getRes.status).toBe(401);

    // POST /api/close anonymous
    const postRes = await closePost(
      new NextRequest("http://localhost:3000/api/close", {
        method: "POST",
        body: JSON.stringify({ month: "2025-05", cashOnHandSen: 0, tngOnHandSen: 0 }),
      }),
    );
    expect(postRes.status).toBe(401);

    // POST /api/close/reopen anonymous
    const reopenRes = await reopenPost(
      new NextRequest("http://localhost:3000/api/close/reopen", {
        method: "POST",
        body: JSON.stringify({ month: "2025-01", reason: "Test" }),
      }),
    );
    expect(reopenRes.status).toBe(401);
  });

  it("validates request payload on POST /api/close", async () => {
    // Missing month
    const bad1 = await closePost(
      makeAuthReq("http://localhost:3000/api/close", operatorSession, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashOnHandSen: 100, tngOnHandSen: 100 }),
      }),
    );
    expect(bad1.status).toBe(400);

    // Missing cashOnHandSen
    const bad2 = await closePost(
      makeAuthReq("http://localhost:3000/api/close", operatorSession, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: "2025-05", tngOnHandSen: 100 }),
      }),
    );
    expect(bad2.status).toBe(400);

    // Empty month without confirmEmpty
    const bad3 = await closePost(
      makeAuthReq("http://localhost:3000/api/close", operatorSession, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: "2025-05",
          cashOnHandSen: 0,
          tngOnHandSen: 0,
        }),
      }),
    );
    expect(bad3.status).toBe(400);
    const bad3Body = await bad3.json();
    expect(bad3Body.error).toContain("zero Daily Sheets");
  });

  it("handles successful close and retrieval via /api/close", async () => {
    const TEST_MONTH = "2025-05";
    const now = new Date("2025-05-25T12:00:00Z");

    // Create a sheet so it's not empty
    const s = await getOrCreateSheet(`${TEST_MONTH}-01`, { db, now });
    await setRevenue(s.id, 10000, 5000, { db });

    // POST /api/close with matching reconciliation (15000 sen net, 10000 cash + 5000 tng)
    const postReq = makeAuthReq(
      "http://localhost:3000/api/close",
      operatorSession,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: TEST_MONTH,
          cashOnHandSen: 10000,
          tngOnHandSen: 5000,
        }),
      },
    );
    const postRes = await closePost(postReq);
    expect(postRes.status).toBe(201);
    const postBody = await postRes.json();
    expect(postBody.close.month).toBe(TEST_MONTH);
    expect(postBody.balanced).toBe(true);
    expect(postBody.differenceSen).toBe(0);

    // GET /api/close?month=2025-05
    const getSingleReq = makeAuthReq(
      `http://localhost:3000/api/close?month=${TEST_MONTH}`,
      operatorSession,
    );
    const getSingleRes = await closeGet(getSingleReq);
    expect(getSingleRes.status).toBe(200);
    const getSingleBody = await getSingleRes.json();
    expect(getSingleBody.close.month).toBe(TEST_MONTH);
    expect(getSingleBody.balanced).toBe(true);

    // GET /api/close (history list)
    const getListReq = makeAuthReq(
      "http://localhost:3000/api/close",
      operatorSession,
    );
    const getListRes = await closeGet(getListReq);
    expect(getListRes.status).toBe(200);
    const getListBody = await getListRes.json();
    expect(Array.isArray(getListBody.closes)).toBe(true);
    expect(getListBody.closes.some((c: any) => c.month === TEST_MONTH)).toBe(
      true,
    );

    // GET non-existent month returns 404
    const getNotFoundReq = makeAuthReq(
      "http://localhost:3000/api/close?month=2024-11",
      operatorSession,
    );
    const getNotFoundRes = await closeGet(getNotFoundReq);
    expect(getNotFoundRes.status).toBe(404);
  });

  it("POST /api/close/reopen: rejects Operator with 403, accepts Admin with 200", async () => {
    const TEST_MONTH = "2025-05";

    // Operator attempts reopen -> 403 Forbidden
    const opReopenReq = makeAuthReq(
      "http://localhost:3000/api/close/reopen",
      operatorSession,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: TEST_MONTH,
          reason: "Operator wants to fix an error",
        }),
      },
    );
    const opReopenRes = await reopenPost(opReopenReq);
    expect(opReopenRes.status).toBe(403);
    const opBody = await opReopenRes.json();
    expect(opBody.error).toContain("Forbidden");

    // Admin attempts reopen without reason -> 400 Bad Request
    const adminBadReq = makeAuthReq(
      "http://localhost:3000/api/close/reopen",
      adminSession,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: TEST_MONTH,
          reason: "",
        }),
      },
    );
    const adminBadRes = await reopenPost(adminBadReq);
    expect(adminBadRes.status).toBe(400);

    // Admin attempts reopen with valid reason -> 200 OK
    const adminGoodReq = makeAuthReq(
      "http://localhost:3000/api/close/reopen",
      adminSession,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: TEST_MONTH,
          reason: "Approved correction for missing fuel expense",
        }),
      },
    );
    const adminGoodRes = await reopenPost(adminGoodReq);
    expect(adminGoodRes.status).toBe(200);
    const adminBody = await adminGoodRes.json();
    expect(adminBody.close.month).toBe(TEST_MONTH);
    expect(adminBody.close.reopenedAt).toBeDefined();
    expect(adminBody.close.reopenReason).toBe(
      "Approved correction for missing fuel expense",
    );
  });
});
