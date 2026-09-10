import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { openDb, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import {
  monthCloses,
  operatingExpenses,
} from "@/db/schema";
import {
  addOperatingExpense,
  ClosedMonthError,
  getMonthPreview,
  isValidOperatingExpenseType,
  listOperatingExpenses,
  NotFoundError,
  removeOperatingExpense,
  updateOperatingExpense,
  ValidationError,
} from "./operating-expense";
import { addCostLine, getOrCreateSheet, setRevenue } from "./daily-sheet";
import {
  DELETE as expensesDelete,
  GET as expensesGet,
  PATCH as expensesPatch,
  POST as expensesPost,
} from "../../app/api/expenses/route";
import { GET as previewGet } from "../../app/api/preview/route";

let tmpDir: string;
let dbPath: string;
let db: Db;
let sqlite: import("better-sqlite3").Database;
const originalDbPath = process.env.BOKLI_DB_PATH;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "bokli-opex-service-test-"),
  );
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

describe("1. Month format validation (YYYY-MM)", () => {
  it("rejects malformed month strings in addOperatingExpense", async () => {
    await expect(
      addOperatingExpense("2025-9", "rental", 10000, null, { db }),
    ).rejects.toThrow(ValidationError);

    await expect(
      addOperatingExpense("2025-13", "rental", 10000, null, { db }),
    ).rejects.toThrow(ValidationError);

    await expect(
      addOperatingExpense("invalid", "rental", 10000, null, { db }),
    ).rejects.toThrow(ValidationError);

    await expect(
      addOperatingExpense("2025/09", "rental", 10000, null, { db }),
    ).rejects.toThrow(ValidationError);

    await expect(
      addOperatingExpense("", "rental", 10000, null, { db }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects malformed month strings in listOperatingExpenses and getMonthPreview", async () => {
    await expect(listOperatingExpenses("2025-00", { db })).rejects.toThrow(
      ValidationError,
    );
    await expect(getMonthPreview("bad-month", { db })).rejects.toThrow(
      ValidationError,
    );
  });

  it("accepts valid YYYY-MM month string", async () => {
    const expense = await addOperatingExpense(
      "2025-01",
      "rental",
      120000,
      "January rental",
      { db },
    );
    expect(expense.id).toBeDefined();
    expect(expense.month).toBe("2025-01");
    expect(expense.type).toBe("rental");
    expect(expense.amountSen).toBe(120000);
  });
});

describe("2. Type and note rules", () => {
  const MONTH = "2025-02";

  it("validates operating expense types enum", () => {
    expect(isValidOperatingExpenseType("rental")).toBe(true);
    expect(isValidOperatingExpenseType("utilities")).toBe(true);
    expect(isValidOperatingExpenseType("wages")).toBe(true);
    expect(isValidOperatingExpenseType("other")).toBe(true);
    expect(isValidOperatingExpenseType("bonus")).toBe(false);
    expect(isValidOperatingExpenseType("")).toBe(false);
    expect(isValidOperatingExpenseType(123)).toBe(false);
  });

  it("rejects invalid operating expense type in addOperatingExpense", async () => {
    await expect(
      addOperatingExpense(MONTH, "unknown" as any, 5000, null, { db }),
    ).rejects.toThrow(ValidationError);
  });

  it("requires note when type is 'other'", async () => {
    // Missing note
    await expect(
      addOperatingExpense(MONTH, "other", 5000, undefined, { db }),
    ).rejects.toThrow(ValidationError);

    // Empty note
    await expect(
      addOperatingExpense(MONTH, "other", 5000, "", { db }),
    ).rejects.toThrow(ValidationError);

    // Whitespace only note
    await expect(
      addOperatingExpense(MONTH, "other", 5000, "   ", { db }),
    ).rejects.toThrow(ValidationError);

    // Non-empty note succeeds
    const expense = await addOperatingExpense(
      MONTH,
      "other",
      5000,
      "Licensing renewal fee",
      { db },
    );
    expect(expense.type).toBe("other");
    expect(expense.note).toBe("Licensing renewal fee");
  });

  it("allows optional note for rental, utilities, and wages", async () => {
    const util = await addOperatingExpense(
      MONTH,
      "utilities",
      35000,
      null,
      { db },
    );
    expect(util.note).toBeNull();

    const wages = await addOperatingExpense(
      MONTH,
      "wages",
      150000,
      undefined,
      { db },
    );
    expect(wages.note).toBeNull();
  });
});

describe("3. Amount validation (sen integer, no floats, non-negative)", () => {
  const MONTH = "2025-03";

  it("rejects negative amount in sen", async () => {
    await expect(
      addOperatingExpense(MONTH, "rental", -100, null, { db }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects float amounts (no floats allowed)", async () => {
    await expect(
      addOperatingExpense(MONTH, "rental", 12.34, null, { db }),
    ).rejects.toThrow(ValidationError);

    await expect(
      addOperatingExpense(MONTH, "rental", 100.5, null, { db }),
    ).rejects.toThrow(ValidationError);

    await expect(
      addOperatingExpense(MONTH, "rental", NaN, null, { db }),
    ).rejects.toThrow(ValidationError);
  });

  it("accepts 0 sen and positive integer sen", async () => {
    const zeroExpense = await addOperatingExpense(
      MONTH,
      "utilities",
      0,
      null,
      { db },
    );
    expect(zeroExpense.amountSen).toBe(0);

    const bigExpense = await addOperatingExpense(
      MONTH,
      "wages",
      250000n,
      null,
      { db },
    );
    expect(bigExpense.amountSen).toBe(250000);
  });
});

describe("4. Closed-month rejection (ClosedMonthError)", () => {
  const CLOSED_MONTH = "2025-04";

  beforeAll(() => {
    // Lock month 2025-04 with a closed month_closes record
    db.insert(monthCloses)
      .values({
        month: CLOSED_MONTH,
        revenueSen: 50000,
        dailyCostSen: 20000,
        grossSen: 30000,
        operatingSen: 10000,
        netSen: 20000,
        closedAt: "2025-05-01T00:00:00Z",
        reopenedAt: null,
      })
      .run();
  });

  it("rejects addOperatingExpense for a closed month", async () => {
    await expect(
      addOperatingExpense(CLOSED_MONTH, "rental", 10000, null, { db }),
    ).rejects.toThrow(ClosedMonthError);
  });

  it("rejects updateOperatingExpense and removeOperatingExpense for a closed month", async () => {
    // Manually insert an expense in the closed month for testing
    const insertRes = db
      .insert(operatingExpenses)
      .values({
        month: CLOSED_MONTH,
        type: "rental",
        amountSen: 80000,
        note: "Pre-close expense",
      })
      .returning()
      .get();

    await expect(
      updateOperatingExpense(
        insertRes.id,
        { amountSen: 90000 },
        { db },
      ),
    ).rejects.toThrow(ClosedMonthError);

    await expect(
      removeOperatingExpense(insertRes.id, { db }),
    ).rejects.toThrow(ClosedMonthError);
  });

  it("allows operations after a closed month is reopened", async () => {
    const REOPENED_MONTH = "2025-05";

    // Insert closed then reopened record
    db.insert(monthCloses)
      .values({
        month: REOPENED_MONTH,
        revenueSen: 10000,
        dailyCostSen: 5000,
        grossSen: 5000,
        operatingSen: 2000,
        netSen: 3000,
        closedAt: "2025-06-01T00:00:00Z",
        reopenedAt: "2025-06-02T10:00:00Z",
        reopenReason: "Late wage adjustment",
      })
      .run();

    const expense = await addOperatingExpense(
      REOPENED_MONTH,
      "rental",
      70000,
      null,
      { db },
    );
    expect(expense.id).toBeDefined();

    const updated = await updateOperatingExpense(
      expense.id,
      { amountSen: 75000 },
      { db },
    );
    expect(updated.amountSen).toBe(75000);

    const removed = await removeOperatingExpense(expense.id, { db });
    expect(removed.success).toBe(true);
  });
});

describe("5. CRUD and listing operations", () => {
  it("lists all operating expenses for a month in order", async () => {
    const month = "2025-06";
    await addOperatingExpense(month, "rental", 100000, "Stall", { db });
    await addOperatingExpense(month, "utilities", 30000, "Electric", { db });
    await addOperatingExpense(month, "wages", 120000, "Worker", { db });

    const list = await listOperatingExpenses(month, { db });
    expect(list).toHaveLength(3);
    expect(list[0].type).toBe("rental");
    expect(list[1].type).toBe("utilities");
    expect(list[2].type).toBe("wages");
  });

  it("updates operating expense type, amount, and note", async () => {
    const month = "2025-07";
    const initial = await addOperatingExpense(
      month,
      "rental",
      90000,
      "Stall",
      { db },
    );

    const updated = await updateOperatingExpense(
      initial.id,
      {
        amountSen: 95000,
        type: "other",
        note: "Stall + maintenance fee",
      },
      { db },
    );

    expect(updated.amountSen).toBe(95000);
    expect(updated.type).toBe("other");
    expect(updated.note).toBe("Stall + maintenance fee");
  });

  it("throws NotFoundError when updating or deleting non-existent expense", async () => {
    await expect(
      updateOperatingExpense(999999, { amountSen: 100 }, { db }),
    ).rejects.toThrow(NotFoundError);

    await expect(
      removeOperatingExpense(999999, { db }),
    ).rejects.toThrow(NotFoundError);
  });

  it("removes operating expense and preserves database integrity", async () => {
    const month = "2025-08";
    const expense = await addOperatingExpense(month, "utilities", 25000, null, {
      db,
    });

    const result = await removeOperatingExpense(expense.id, { db });
    expect(result.success).toBe(true);
    expect(result.removedExpense.id).toBe(expense.id);

    const afterList = await listOperatingExpenses(month, { db });
    expect(afterList.some((e) => e.id === expense.id)).toBe(false);
  });
});

describe("6. Live month preview calculation (gross & net profit in sen)", () => {
  it("returns zero preview for an empty month", async () => {
    const preview = await getMonthPreview("2025-09", { db });
    expect(preview.month).toBe("2025-09");
    expect(preview.revenueSen).toBe(0n);
    expect(preview.dailyCostSen).toBe(0n);
    expect(preview.grossSen).toBe(0n);
    expect(preview.operatingSen).toBe(0n);
    expect(preview.netSen).toBe(0n);
  });

  it("computes live preview accurately from Daily Sheets, Cost Lines, and Operating Expenses", async () => {
    const targetMonth = "2025-10";

    // Day 1: Cash = 30000 sen (RM300), TnG = 20000 sen (RM200) -> Rev = 50000 sen
    const sheet1 = await getOrCreateSheet(`${targetMonth}-01`, { db });
    await setRevenue(sheet1.id, 30000, 20000, { db });
    await addCostLine(sheet1.id, 10000, "restock", null, { db });
    await addCostLine(sheet1.id, 4000, "gas", null, { db });
    // Day 1 costs = 14000 sen

    // Day 2: Cash = 40000 sen (RM400), TnG = 15000 sen (RM150) -> Rev = 55000 sen
    const sheet2 = await getOrCreateSheet(`${targetMonth}-02`, { db });
    await setRevenue(sheet2.id, 40000, 15000, { db });
    await addCostLine(sheet2.id, 6000, "transport", null, { db });
    // Day 2 costs = 6000 sen

    // Total month revenue = 50000 + 55000 = 105000 sen
    // Total daily costs = 14000 + 6000 = 20000 sen
    // Gross profit before operating expenses = 105000 - 20000 = 85000 sen
    let preview = await getMonthPreview(targetMonth, { db });
    expect(preview.revenueSen).toBe(105000n);
    expect(preview.dailyCostSen).toBe(20000n);
    expect(preview.grossSen).toBe(85000n);
    expect(preview.operatingSen).toBe(0n);
    expect(preview.netSen).toBe(85000n);

    // Add Operating Expenses
    // Rental = 50000 sen
    await addOperatingExpense(targetMonth, "rental", 50000, null, { db });
    // Utilities = 15000 sen
    await addOperatingExpense(targetMonth, "utilities", 15000, null, { db });

    // Total Operating Expenses = 65000 sen
    // Net profit = Gross (85000) - Operating (65000) = 20000 sen
    preview = await getMonthPreview(targetMonth, { db });
    expect(preview.revenueSen).toBe(105000n);
    expect(preview.dailyCostSen).toBe(20000n);
    expect(preview.grossSen).toBe(85000n);
    expect(preview.operatingSen).toBe(65000n);
    expect(preview.netSen).toBe(20000n);
  });

  it("correctly handles negative gross profit and net profit when costs exceed revenue", async () => {
    const lossMonth = "2025-11";

    // Sheet with 1000 sen revenue and 3000 sen cost -> Gross = -2000 sen
    const sheet = await getOrCreateSheet(`${lossMonth}-05`, { db });
    await setRevenue(sheet.id, 1000, 0, { db });
    await addCostLine(sheet.id, 3000, "gas", null, { db });

    // Operating expense = 5000 sen -> Net = -2000 - 5000 = -7000 sen
    await addOperatingExpense(lossMonth, "utilities", 5000, null, { db });

    const preview = await getMonthPreview(lossMonth, { db });
    expect(preview.revenueSen).toBe(1000n);
    expect(preview.dailyCostSen).toBe(3000n);
    expect(preview.grossSen).toBe(-2000n);
    expect(preview.operatingSen).toBe(5000n);
    expect(preview.netSen).toBe(-7000n);
  });
});

describe("7. API routes & Auth guard protection (/api/expenses and /api/preview)", () => {
  it("rejects anonymous requests with 401 Unauthorized", async () => {
    // GET /api/expenses anonymous
    const getExpReq = new NextRequest(
      "http://localhost:3000/api/expenses?month=2025-12",
    );
    const getExpRes = await expensesGet(getExpReq);
    expect(getExpRes.status).toBe(401);
    const getExpBody = await getExpRes.json();
    expect(getExpBody.error).toBe("Unauthorized");

    // POST /api/expenses anonymous
    const postExpReq = new NextRequest(
      "http://localhost:3000/api/expenses",
      {
        method: "POST",
        body: JSON.stringify({
          month: "2025-12",
          type: "rental",
          amountSen: 1000,
        }),
      },
    );
    const postExpRes = await expensesPost(postExpReq);
    expect(postExpRes.status).toBe(401);

    // PATCH /api/expenses anonymous
    const patchExpReq = new NextRequest(
      "http://localhost:3000/api/expenses?id=1",
      {
        method: "PATCH",
        body: JSON.stringify({ amountSen: 2000 }),
      },
    );
    const patchExpRes = await expensesPatch(patchExpReq);
    expect(patchExpRes.status).toBe(401);

    // DELETE /api/expenses anonymous
    const deleteExpReq = new NextRequest(
      "http://localhost:3000/api/expenses?id=1",
      {
        method: "DELETE",
      },
    );
    const deleteExpRes = await expensesDelete(deleteExpReq);
    expect(deleteExpRes.status).toBe(401);

    // GET /api/preview anonymous
    const getPrevReq = new NextRequest(
      "http://localhost:3000/api/preview?month=2025-12",
    );
    const getPrevRes = await previewGet(getPrevReq);
    expect(getPrevRes.status).toBe(401);
    const getPrevBody = await getPrevRes.json();
    expect(getPrevBody.error).toBe("Unauthorized");
  });

  it("handles authenticated CRUD on /api/expenses and live preview on /api/preview", async () => {
    const authSession = {
      user: { id: "2", name: "katte", role: "Admin" as const },
    };

    function makeAuthReq(url: string, init?: any) {
      const req = new NextRequest(url, init);
      (req as any).auth = authSession;
      return req;
    }

    const testMonth = "2025-12";

    // 1. Validation error on missing month query in GET /api/expenses
    const badGetReq = makeAuthReq("http://localhost:3000/api/expenses");
    const badGetRes = await expensesGet(badGetReq);
    expect(badGetRes.status).toBe(400);

    // 2. Validation error on invalid body in POST /api/expenses
    const badPostReq = makeAuthReq("http://localhost:3000/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: testMonth,
        type: "other",
        amountSen: 5000,
        // missing note for 'other'
      }),
    });
    const badPostRes = await expensesPost(badPostReq);
    expect(badPostRes.status).toBe(400);

    // 3. Successful POST /api/expenses
    const postReq = makeAuthReq("http://localhost:3000/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: testMonth,
        type: "rental",
        amountSen: 120000,
        note: "Stall rental Dec",
      }),
    });
    const postRes = await expensesPost(postReq);
    expect(postRes.status).toBe(201);
    const postData = await postRes.json();
    expect(postData.merged).toBe(false);
    expect(postData.expense.id).toBeDefined();
    expect(postData.expense.type).toBe("rental");
    expect(postData.expense.amountSen).toBe(120000);

    const expenseId = postData.expense.id;

    // 3b. Duplicate POST /api/expenses merges and returns 200
    const mergePostReq = makeAuthReq("http://localhost:3000/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: testMonth,
        type: "rental",
        amountSen: 30000,
        note: "Stall rental Dec",
      }),
    });
    const mergePostRes = await expensesPost(mergePostReq);
    expect(mergePostRes.status).toBe(200);
    const mergePostData = await mergePostRes.json();
    expect(mergePostData.merged).toBe(true);
    expect(mergePostData.expense.id).toBe(expenseId);
    expect(mergePostData.expense.amountSen).toBe(150000);

    // 4. GET /api/expenses?month=2025-12
    const getReq = makeAuthReq(
      `http://localhost:3000/api/expenses?month=${testMonth}`,
    );
    const getRes = await expensesGet(getReq);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.expenses).toHaveLength(1);
    expect(getData.expenses[0].id).toBe(expenseId);

    // 5. PATCH /api/expenses?id=...
    const patchReq = makeAuthReq(
      `http://localhost:3000/api/expenses?id=${expenseId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountSen: 125000,
        }),
      },
    );
    const patchRes = await expensesPatch(patchReq);
    expect(patchRes.status).toBe(200);
    const patchData = await patchRes.json();
    expect(patchData.expense.amountSen).toBe(125000);

    // 6. GET /api/preview?month=2025-12
    const prevReq = makeAuthReq(
      `http://localhost:3000/api/preview?month=${testMonth}`,
    );
    const prevRes = await previewGet(prevReq);
    expect(prevRes.status).toBe(200);
    const prevData = await prevRes.json();
    expect(prevData.month).toBe(testMonth);
    expect(prevData.revenueSen).toBe(0);
    expect(prevData.dailyCostSen).toBe(0);
    expect(prevData.grossSen).toBe(0);
    expect(prevData.operatingSen).toBe(125000);
    expect(prevData.netSen).toBe(-125000);

    // 7. Validation error on GET /api/preview without month
    const badPrevReq = makeAuthReq("http://localhost:3000/api/preview");
    const badPrevRes = await previewGet(badPrevReq);
    expect(badPrevRes.status).toBe(400);

    // 8. DELETE /api/expenses?id=...
    const delReq = makeAuthReq(
      `http://localhost:3000/api/expenses?id=${expenseId}`,
      {
        method: "DELETE",
      },
    );
    const delRes = await expensesDelete(delReq);
    expect(delRes.status).toBe(200);
    const delData = await delRes.json();
    expect(delData.success).toBe(true);
    expect(delData.removedExpense.id).toBe(expenseId);
  });
});

describe("8. Duplicate merging behavior", () => {
  it("merges duplicate expenses with same month, type, and note into a single row and updates amount", async () => {
    const month = "2026-01";
    const first = await addOperatingExpense(month, "rental", 7000, "s", { db });
    const second = await addOperatingExpense(month, "rental", 2000, "s", { db });

    const rows = await listOperatingExpenses(month, { db });
    expect(rows).toHaveLength(1);
    expect(rows[0].amountSen).toBe(9000);
    expect(rows[0].id).toBe(first.id);
    expect(second.id).toBe(first.id);
    expect(second.amountSen).toBe(9000);
  });

  it("keeps expenses with same month and type but different notes separate", async () => {
    const month = "2026-02";
    const first = await addOperatingExpense(month, "rental", 7000, "stall A", { db });
    const second = await addOperatingExpense(month, "rental", 2000, "stall B", { db });

    const rows = await listOperatingExpenses(month, { db });
    expect(rows).toHaveLength(2);
    expect(first.id).not.toBe(second.id);
    expect(rows.find((r) => r.note === "stall A")?.amountSen).toBe(7000);
    expect(rows.find((r) => r.note === "stall B")?.amountSen).toBe(2000);
  });

  it("keeps expenses with same note but different type separate", async () => {
    const month = "2026-03";
    const first = await addOperatingExpense(month, "rental", 7000, "deposit", { db });
    const second = await addOperatingExpense(month, "utilities", 2000, "deposit", { db });

    const rows = await listOperatingExpenses(month, { db });
    expect(rows).toHaveLength(2);
    expect(first.id).not.toBe(second.id);
    expect(rows.find((r) => r.type === "rental")?.amountSen).toBe(7000);
    expect(rows.find((r) => r.type === "utilities")?.amountSen).toBe(2000);
  });

  it("merges duplicate expenses when note is null or whitespace", async () => {
    const month = "2026-04";
    const first = await addOperatingExpense(month, "rental", 5000, null, { db });
    const second = await addOperatingExpense(month, "rental", 3000, "   ", { db });

    const rows = await listOperatingExpenses(month, { db });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].amountSen).toBe(8000);
    expect(rows[0].note).toBeNull();
    expect(second.id).toBe(first.id);
    expect(second.amountSen).toBe(8000);
  });
it("safely merges concurrent duplicate expenses via transaction without double-insert", async () => {
    const month = "2026-05";
    const [first, second] = await Promise.all([
      addOperatingExpense(month, "rental", 4000, "concurrent", { db }),
      addOperatingExpense(month, "rental", 6000, "concurrent", { db }),
    ]);

    const rows = await listOperatingExpenses(month, { db });
    expect(rows).toHaveLength(1);
    expect(rows[0].amountSen).toBe(10000);
    expect(rows[0].note).toBe("concurrent");
    expect(first.id).toBe(second.id);
  });

  it("throws ValidationError when merged amount exceeds MAX_SEN", async () => {
    const month = "2026-06";
    const initial = await addOperatingExpense(month, "rental", 9007199254740900n, "max-check", { db });
    expect(initial.amountSen).toBe(Number(9007199254740900n));

    await expect(
      addOperatingExpense(month, "rental", 200n, "max-check", { db }),
    ).rejects.toThrow(ValidationError);
  });

  it("updates updatedAt timestamp when merging duplicate operating expense", async () => {
    const month = "2026-07";
    const first = await addOperatingExpense(month, "rental", 5000, "audit-check", { db });
    expect(first.updatedAt).toBeDefined();

    // Small delay to ensure timestamp progression
    await new Promise((resolve) => setTimeout(resolve, 15));

    const second = await addOperatingExpense(month, "rental", 3000, "audit-check", { db });
    expect(second.id).toBe(first.id);
    expect(second.updatedAt).toBeDefined();
    expect(new Date(second.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.updatedAt).getTime(),
    );

    const rows = await listOperatingExpenses(month, { db });
    expect(rows).toHaveLength(1);
    expect(rows[0].updatedAt).toBe(second.updatedAt);
  });
});
