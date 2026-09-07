import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { openDb, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import {
  costLines,
  dailySheets,
  monthCloses,
  operatingExpenses,
} from "@/db/schema";
import {
  getDashboard,
  getCostByCategory,
  getDailyTrend,
  getMonthTile,
  getCashTngSplit,
  listMonthTiles,
} from "./dashboard";
import { addCostLine, getOrCreateSheet, setRevenue } from "./daily-sheet";
import { addOperatingExpense } from "./operating-expense";
import { closeMonth, reopenMonth } from "./month-close";
import { GET as dashboardGet } from "../../app/api/dashboard/route";

let tmpDir: string;
let dbPath: string;
let db: Db;
let sqlite: import("better-sqlite3").Database;
const originalDbPath = process.env.BOKLI_DB_PATH;

const TEST_MONTH = "2025-02";

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-dashboard-test-"));
  dbPath = path.join(tmpDir, "test.db");
  process.env.BOKLI_DB_PATH = dbPath;

  const opened = openDb(dbPath);
  db = opened.db;
  sqlite = opened.sqlite;
  runMigrations(dbPath);

  // Setup seed data for 2025-02
  // Daily Sheet 1: 2025-02-01
  const s1 = await getOrCreateSheet("2025-02-01", { db });
  await setRevenue(s1.id, 15000, 8000, { db }); // 150.00 cash + 80.00 tng = 230.00 rev
  await addCostLine(s1.id, 4000, "restock", null, { db }); // 40.00 restock
  await addCostLine(s1.id, 2000, "gas", null, { db }); // 20.00 gas
  await addCostLine(s1.id, 1000, "other", "Ice cubes", { db }); // 10.00 other

  // Daily Sheet 2: 2025-02-02
  const s2 = await getOrCreateSheet("2025-02-02", { db });
  await setRevenue(s2.id, 20000, 12000, { db }); // 200.00 cash + 120.00 tng = 320.00 rev
  await addCostLine(s2.id, 3000, "transport", null, { db }); // 30.00 transport
  await addCostLine(s2.id, 5000, "wages-daily", null, { db }); // 50.00 wages-daily

  // Operating Expenses for 2025-02
  await addOperatingExpense(TEST_MONTH, "rental", 10000, null, { db }); // 100.00 rental
  await addOperatingExpense(TEST_MONTH, "utilities", 5000, null, { db }); // 50.00 utilities

  // Additional month for listMonthTiles test: 2024-11
  const sOld = await getOrCreateSheet("2024-11-10", { db });
  await setRevenue(sOld.id, 5000, 5000, { db });
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

describe("Dashboard Service - getMonthTile", () => {
  it("calculates live revenue, cost, gross, operating, and net for open month", async () => {
    const tile = await getMonthTile(TEST_MONTH, { db });

    // Revenue: (15000+8000) + (20000+12000) = 23000 + 32000 = 55000 sen
    expect(tile.revenueSen).toBe(55000n);
    // Daily Cost: (4000+2000+1000) + (3000+5000) = 7000 + 8000 = 15000 sen
    expect(tile.dailyCostSen).toBe(15000n);
    // Gross: 55000 - 15000 = 40000 sen
    expect(tile.grossSen).toBe(40000n);
    // Operating: 10000 + 5000 = 15000 sen
    expect(tile.operatingSen).toBe(15000n);
    // Net: 40000 - 15000 = 25000 sen
    expect(tile.netSen).toBe(25000n);
    expect(tile.status).toBe("open");
    expect(tile.balanced).toBeUndefined();
  });
});

describe("Dashboard Service - getDailyTrend", () => {
  it("returns chronological daily rows with cashSen, tngSen, and totalSen", async () => {
    const trend = await getDailyTrend(TEST_MONTH, { db });

    expect(trend).toHaveLength(2);

    expect(trend[0].date).toBe("2025-02-01");
    expect(trend[0].cashSen).toBe(15000n);
    expect(trend[0].tngSen).toBe(8000n);
    expect(trend[0].totalSen).toBe(23000n);

    expect(trend[1].date).toBe("2025-02-02");
    expect(trend[1].cashSen).toBe(20000n);
    expect(trend[1].tngSen).toBe(12000n);
    expect(trend[1].totalSen).toBe(32000n);
  });
});

describe("Dashboard Service - getCashTngSplit", () => {
  it("computes accurate month-level cash versus tng split", async () => {
    const split = await getCashTngSplit(TEST_MONTH, { db });

    // Cash: 15000 + 20000 = 35000 sen
    expect(split.cashSen).toBe(35000n);
    // TnG: 8000 + 12000 = 20000 sen
    expect(split.tngSen).toBe(20000n);
    // Total: 55000 sen
    expect(split.totalSen).toBe(55000n);
    expect(split.cashSen + split.tngSen).toBe(split.totalSen);
  });
});

describe("Dashboard Service - getCostByCategory", () => {
  it("breaks down daily costs across all 5 cost categories", async () => {
    const costs = await getCostByCategory(TEST_MONTH, { db });

    expect(costs.restock).toBe(4000n);
    expect(costs.gas).toBe(2000n);
    expect(costs.transport).toBe(3000n);
    expect(costs["wages-daily"]).toBe(5000n);
    expect(costs.other).toBe(1000n);

    const sumAll =
      costs.restock +
      costs.gas +
      costs.transport +
      costs["wages-daily"] +
      costs.other;
    expect(sumAll).toBe(15000n);
  });
});

describe("Dashboard Service - Closed and Reopened month handling", () => {
  const closedMonth = "2025-01";
  const reopenedMonth = "2024-12";

  beforeAll(async () => {
    // 2025-01: Close month with balanced reconciliation
    const s1 = await getOrCreateSheet("2025-01-10", { db });
    await setRevenue(s1.id, 10000, 10000, { db }); // 20000 sen revenue
    // Net profit = 20000 sen (no cost, no opex)
    // Close with cashOnHand = 10000 sen, tngOnHand = 10000 sen (balanced)
    await closeMonth(closedMonth, 10000, 10000, null, { db });

    // 2024-12: Close month with mismatch, then reopen
    const s2 = await getOrCreateSheet("2024-12-15", { db });
    await setRevenue(s2.id, 5000, 5000, { db }); // 10000 sen revenue
    // Net profit = 10000 sen
    // Close with cashOnHand = 4000, tngOnHand = 5000 => actual = 9000 (diff -1000, note required)
    await closeMonth(reopenedMonth, 4000, 5000, "Variance due to coin rounding", { db });
    // Now reopen by Admin
    await reopenMonth(reopenedMonth, "Need to add missing receipt", { role: "Admin", db });
  });

  it("returns status: 'closed' and balanced: true for balanced closed month", async () => {
    const tile = await getMonthTile(closedMonth, { db });
    expect(tile.status).toBe("closed");
    expect(tile.balanced).toBe(true);
    expect(tile.revenueSen).toBe(20000n);
    expect(tile.netSen).toBe(20000n);
  });

  it("returns status: 'reopened' for reopened month", async () => {
    const tile = await getMonthTile(reopenedMonth, { db });
    expect(tile.status).toBe("reopened");
  });

  it("evaluates balanced correctly when closed month has reconciliation mismatch", async () => {
    // Re-close 2024-12 with mismatch
    await closeMonth(reopenedMonth, 4000, 5000, "Mismatched note", { db });
    const tile = await getMonthTile(reopenedMonth, { db });
    expect(tile.status).toBe("closed");
    expect(tile.balanced).toBe(false);
  });
});

describe("Dashboard Service - listMonthTiles", () => {
  it("lists all recorded months in descending order", async () => {
    const tiles = await listMonthTiles({ db });
    const months = tiles.map((t) => t.month);

    // Should contain 2025-02, 2025-01, 2024-12, 2024-11
    expect(months).toContain("2025-02");
    expect(months).toContain("2025-01");
    expect(months).toContain("2024-12");
    expect(months).toContain("2024-11");

    // Must be in descending order
    for (let i = 0; i < months.length - 1; i++) {
      expect(months[i] >= months[i + 1]).toBe(true);
    }
  });

  it("supports limit parameter", async () => {
    const tiles = await listMonthTiles({ limit: 2, db });
    expect(tiles).toHaveLength(2);
  });

  it("supports upToMonth parameter", async () => {
    const tiles = await listMonthTiles({ upToMonth: "2025-01", db });
    for (const t of tiles) {
      expect(t.month <= "2025-01").toBe(true);
    }
  });
});

describe("Dashboard Service - read-only guarantee (no mutation)", () => {
  it("does not mutate database state on queries", async () => {
    const sheetsBefore = db.select().from(dailySheets).all();
    const costsBefore = db.select().from(costLines).all();
    const expensesBefore = db.select().from(operatingExpenses).all();
    const closesBefore = db.select().from(monthCloses).all();

    // Call all dashboard methods
    await getMonthTile("2025-02", { db });
    await getDailyTrend("2025-02", { db });
    await getCashTngSplit("2025-02", { db });
    await getCostByCategory("2025-02", { db });
    await listMonthTiles({ db });
    await getDashboard("2025-02", { db });

    const sheetsAfter = db.select().from(dailySheets).all();
    const costsAfter = db.select().from(costLines).all();
    const expensesAfter = db.select().from(operatingExpenses).all();
    const closesAfter = db.select().from(monthCloses).all();

    expect(sheetsAfter).toEqual(sheetsBefore);
    expect(costsAfter).toEqual(costsBefore);
    expect(expensesAfter).toEqual(expensesBefore);
    expect(closesAfter).toEqual(closesBefore);
  });
});

describe("Dashboard API route - GET /api/dashboard", () => {
  const operatorSession = {
    user: { id: "1", username: "operator1", role: "Operator" as const },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };

  function makeAuthReq(url: string, session = operatorSession) {
    const req = new NextRequest(url);
    (req as any).auth = session;
    return req;
  }

  it("rejects unauthenticated requests with 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/dashboard");
    const res = await dashboardGet(req);
    expect(res.status).toBe(401);
  });

  it("rejects invalid month format with 400", async () => {
    const req = makeAuthReq("http://localhost:3000/api/dashboard?month=invalid");
    const res = await dashboardGet(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 for month with no data", async () => {
    const req = makeAuthReq("http://localhost:3000/api/dashboard?month=2099-01");
    const res = await dashboardGet(req);
    expect(res.status).toBe(404);
  });

  it("returns full dashboard data for a valid month", async () => {
    const req = makeAuthReq(`http://localhost:3000/api/dashboard?month=${TEST_MONTH}`);
    const res = await dashboardGet(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.tile).toBeDefined();
    expect(json.tile.month).toBe(TEST_MONTH);
    expect(json.tile.revenueSen).toBe(55000);
    expect(json.tile.dailyCostSen).toBe(15000);
    expect(json.tile.grossSen).toBe(40000);
    expect(json.tile.operatingSen).toBe(15000);
    expect(json.tile.netSen).toBe(25000);
    expect(json.tile.status).toBe("open");

    expect(json.trend).toHaveLength(2);
    expect(json.split.cashSen).toBe(35000);
    expect(json.split.tngSen).toBe(20000);
    expect(json.costByCategory.restock).toBe(4000);
    expect(json.costByCategory["wages-daily"]).toBe(5000);
  });

  it("returns month tiles list when no month is specified", async () => {
    const req = makeAuthReq("http://localhost:3000/api/dashboard");
    const res = await dashboardGet(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(Array.isArray(json.tiles)).toBe(true);
    expect(json.tiles.length).toBeGreaterThan(0);
    expect(json.tiles.some((t: any) => t.month === TEST_MONTH)).toBe(true);
  });
});
