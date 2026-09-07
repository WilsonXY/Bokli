import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { openDb, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { costLines, dailySheets, monthCloses, operatingExpenses } from "@/db/schema";
import {
  getCashTngSplit,
  getCostByCategory,
  getDailyTrend,
  getDashboard,
  getMonthTile,
  hasMonthData,
  listMonthTiles,
  ValidationError,
} from "./dashboard";
import {
  addCostLine,
  getOrCreateSheet,
  setRevenue,
} from "./daily-sheet";
import { addOperatingExpense } from "./operating-expense";
import { closeMonth, reopenMonth } from "./month-close";
import { GET as dashboardGet } from "../../app/api/dashboard/route";

let tmpDir: string;
let dbPath: string;
let db: Db;
let sqlite: import("better-sqlite3").Database;
const originalDbPath = process.env.BOKLI_DB_PATH;

const operatorSession = {
  user: {
    id: "1",
    name: "Mom",
    username: "mom",
    role: "Operator",
  },
};

function makeAuthReq(url: string, session: any, init?: any) {
  const req = new NextRequest(url, init);
  (req as any).auth = session;
  return req;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-dashboard-test-"));
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

describe("Dashboard Service - input validation", () => {
  it("rejects invalid month format in getMonthTile", async () => {
    await expect(getMonthTile("2025-5", { db })).rejects.toThrow(ValidationError);
    await expect(getMonthTile("invalid", { db })).rejects.toThrow(ValidationError);
    await expect(getMonthTile("2025-13", { db })).rejects.toThrow(ValidationError);
  });

  it("rejects invalid month format in getDailyTrend, getCashTngSplit, getCostByCategory", async () => {
    await expect(getDailyTrend("2025-1", { db })).rejects.toThrow(ValidationError);
    await expect(getCashTngSplit("2025-1", { db })).rejects.toThrow(ValidationError);
    await expect(getCostByCategory("2025-1", { db })).rejects.toThrow(ValidationError);
  });
});

describe("Dashboard Service - fixture month (open month)", () => {
  const month = "2025-02";

  beforeAll(async () => {
    // Day 1: 2025-02-05 - Cash: RM500 (50000 sen), TnG: RM200 (20000 sen)
    // Costs: Restock RM150 (15000 sen), Gas RM50 (5000 sen)
    const s1 = await getOrCreateSheet("2025-02-05", { db });
    await setRevenue(s1.id, 50000, 20000, { db });
    await addCostLine(s1.id, 15000, "restock", "vegetables", { db });
    await addCostLine(s1.id, 5000, "gas", null, { db });

    // Day 2: 2025-02-12 - Cash: RM300 (30000 sen), TnG: RM400 (40000 sen)
    // Costs: Transport RM30 (3000 sen), Wages RM100 (10000 sen), Other RM20 (2000 sen)
    const s2 = await getOrCreateSheet("2025-02-12", { db });
    await setRevenue(s2.id, 30000, 40000, { db });
    await addCostLine(s2.id, 3000, "transport", null, { db });
    await addCostLine(s2.id, 10000, "wages-daily", null, { db });
    await addCostLine(s2.id, 2000, "other", "stall light bulb", { db });

    // Operating expenses for month: Rental RM800 (80000 sen), Utilities RM120 (12000 sen)
    await addOperatingExpense(month, "rental", 80000, null, { db });
    await addOperatingExpense(month, "utilities", 12000, null, { db });
  });

  it("calculates MonthTile correctly for open month", async () => {
    const tile = await getMonthTile(month, { db });

    // Revenue: (50000 + 20000) + (30000 + 40000) = 140000 sen
    expect(tile.revenueSen).toBe(140000n);
    // Daily Cost: 15000 + 5000 + 3000 + 10000 + 2000 = 35000 sen
    expect(tile.dailyCostSen).toBe(35000n);
    // Gross: 140000 - 35000 = 105000 sen
    expect(tile.grossSen).toBe(105000n);
    // Operating: 80000 + 12000 = 92000 sen
    expect(tile.operatingSen).toBe(92000n);
    // Net: 105000 - 92000 = 13000 sen
    expect(tile.netSen).toBe(13000n);
    expect(tile.status).toBe("open");
    expect(tile.balanced).toBeUndefined();
  });

  it("returns daily trend rows in chronological order", async () => {
    const trend = await getDailyTrend(month, { db });
    expect(trend).toHaveLength(2);

    expect(trend[0]).toEqual({
      date: "2025-02-05",
      cashSen: 50000n,
      tngSen: 20000n,
      totalSen: 70000n,
    });

    expect(trend[1]).toEqual({
      date: "2025-02-12",
      cashSen: 30000n,
      tngSen: 40000n,
      totalSen: 70000n,
    });
  });

  it("calculates cash vs TnG split totals", async () => {
    const split = await getCashTngSplit(month, { db });
    // Cash: 50000 + 30000 = 80000 sen
    expect(split.cashSen).toBe(80000n);
    // TnG: 20000 + 40000 = 60000 sen
    expect(split.tngSen).toBe(60000n);
    // Total: 140000 sen
    expect(split.totalSen).toBe(140000n);
  });

  it("aggregates cost by Cost Category enum", async () => {
    const costCat = await getCostByCategory(month, { db });
    expect(costCat).toEqual({
      restock: 15000n,
      gas: 5000n,
      transport: 3000n,
      "wages-daily": 10000n,
      other: 2000n,
    });
  });

  it("getDashboard bundles tile, trend, split, and costByCategory", async () => {
    const dash = await getDashboard(month, { db });
    expect(dash.tile.month).toBe(month);
    expect(dash.trend).toHaveLength(2);
    expect(dash.split.totalSen).toBe(140000n);
    expect(dash.costByCategory.restock).toBe(15000n);
  });
});

describe("Dashboard Service - closed and reopened month statuses", () => {
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
    await reopenMonth(reopenedMonth, "Need to add missing receipt", "Admin", { db });
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
    expect(tile.revenueSen).toBe(10000n);
    expect(tile.netSen).toBe(10000n);
  });

  it("handles closed month with reconciliation mismatch", async () => {
    const mismatchMonth = "2024-11";
    const s = await getOrCreateSheet("2024-11-05", { db });
    await setRevenue(s.id, 20000, 0, { db });
    await closeMonth(mismatchMonth, 18000, 0, "Missing 20 MYR cash", { db });

    const tile = await getMonthTile(mismatchMonth, { db });
    expect(tile.status).toBe("closed");
    expect(tile.balanced).toBe(false);
  });
});

describe("Dashboard Service - listMonthTiles", () => {
  it("lists all recorded months in descending order", async () => {
    const tiles = await listMonthTiles(undefined, { db });
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
    const tiles = await listMonthTiles(2, { db });
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
    await listMonthTiles(undefined, { db });
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

describe("API Route - GET /api/dashboard", () => {
  it("rejects unauthenticated requests with 401 Unauthorized", async () => {
    const req = new NextRequest("http://localhost:3000/api/dashboard");
    const res = await dashboardGet(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid month parameter", async () => {
    const req = makeAuthReq("http://localhost:3000/api/dashboard?month=bad-month", operatorSession);
    const res = await dashboardGet(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid month/);
  });

  it("returns 404 for month with no bookkeeping data", async () => {
    const req = makeAuthReq("http://localhost:3000/api/dashboard?month=1999-01", operatorSession);
    const res = await dashboardGet(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/);
  });

  it("returns month data with tile, trend, split, and costByCategory for valid month", async () => {
    const req = makeAuthReq("http://localhost:3000/api/dashboard?month=2025-02", operatorSession);
    const res = await dashboardGet(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.tile).toBeDefined();
    expect(json.tile.month).toBe("2025-02");
    expect(json.tile.revenueSen).toBe(140000);
    expect(json.tile.dailyCostSen).toBe(35000);
    expect(json.tile.grossSen).toBe(105000);
    expect(json.tile.operatingSen).toBe(92000);
    expect(json.tile.netSen).toBe(13000);
    expect(json.tile.status).toBe("open");

    expect(json.trend).toHaveLength(2);
    expect(json.trend[0].date).toBe("2025-02-05");
    expect(json.trend[0].totalSen).toBe(70000);

    expect(json.split).toEqual({
      cashSen: 80000,
      tngSen: 60000,
      totalSen: 140000,
    });

    expect(json.costByCategory).toEqual({
      restock: 15000,
      gas: 5000,
      transport: 3000,
      "wages-daily": 10000,
      other: 2000,
    });
  });

  it("returns list of month tiles when month parameter is omitted", async () => {
    const req = makeAuthReq("http://localhost:3000/api/dashboard", operatorSession);
    const res = await dashboardGet(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(Array.isArray(json.tiles)).toBe(true);
    expect(json.tiles.length).toBeGreaterThanOrEqual(4);
    expect(json.tiles[0].month).toBeDefined();
    expect(typeof json.tiles[0].revenueSen).toBe("number");
  });
});
