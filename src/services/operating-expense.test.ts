import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { openDb, type Db } from "@/db";
import { MAX_BODY_JSON_BYTES } from "@/lib/parse";
import { runMigrations } from "@/db/migrate";
import {
  monthCloses,
  operatingExpenses,
} from "@/db/schema";
import { ClosedMonthError, NotFoundError, ValidationError } from "./errors";
import {
  addOperatingExpense,
  deleteOperatingExpenses,
  getMonthPreview,
  isValidOperatingExpenseType,
  listOperatingExpenses,
  removeOperatingExpense,
  updateOperatingExpense,
} from "./operating-expense";
import { addCostLine, getOrCreateSheet, setRevenue } from "./daily-sheet";
import {
  DELETE as expensesDelete,
  POST as expensesPost,
} from "../../app/api/expenses/route";

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

    // The error carries the stable code the client translates (NOT the
    // variance one, which the English prose alone would collide with).
    await expect(
      addOperatingExpense(MONTH, "other", 5000, undefined, { db }),
    ).rejects.toMatchObject({ code: "otherNoteRequired" });

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

  it("rejects non-string note with ValidationError (not TypeError) in addOperatingExpense and updateOperatingExpense", async () => {
    await expect(
      addOperatingExpense(MONTH, "rental", 5000, 123 as any, { db }),
    ).rejects.toThrow(ValidationError);

    await expect(
      addOperatingExpense(MONTH, "rental", 5000, true as any, { db }),
    ).rejects.toThrow(ValidationError);

    const exp = await addOperatingExpense(MONTH, "rental", 5000, "Initial", { db });
    await expect(
      updateOperatingExpense(exp.id, { note: 123 as any }, { db }),
    ).rejects.toThrow(ValidationError);
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

  it("updates updatedAt timestamp on edit", async () => {
    const month = "2025-07";
    const initial = await addOperatingExpense(
      month,
      "rental",
      90000,
      "Stall",
      { db },
    );

    // Set an older timestamp in the database to verify the update modifies updatedAt
    db.update(operatingExpenses)
      .set({ updatedAt: "2020-01-01T00:00:00.000Z" })
      .where(eq(operatingExpenses.id, initial.id))
      .run();

    const updated = await updateOperatingExpense(
      initial.id,
      { amountSen: 95000 },
      { db },
    );

    expect(updated.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date("2020-01-01T00:00:00.000Z").getTime(),
    );
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

describe("7. API routes & Auth guard protection (/api/expenses)", () => {
  it("rejects anonymous requests with 401 Unauthorized", async () => {
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
    const postExpBody = await postExpRes.json();
    expect(postExpBody.error).toBe("Unauthorized");
    // The 401 carries the stable code too, so the client's structured path
    // covers auth failures instead of falling back to prose matching.
    expect(postExpBody.code).toBe("unauthorized");

    // DELETE /api/expenses anonymous
    const deleteExpReq = new NextRequest(
      "http://localhost:3000/api/expenses?id=1",
      {
        method: "DELETE",
      },
    );
    const deleteExpRes = await expensesDelete(deleteExpReq);
    expect(deleteExpRes.status).toBe(401);
  });

  it("handles authenticated create and delete on /api/expenses", async () => {
    const authSession = {
      user: { id: "2", name: "katte", role: "Admin" as const },
    };

    function makeAuthReq(url: string, init?: any) {
      const req = new NextRequest(url, init);
      (req as any).auth = authSession;
      return req;
    }

    const testMonth = "2025-12";

    // 1. Validation error on invalid body in POST /api/expenses
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

    // 2. Missing 'month' field in POST /api/expenses
    const noMonthReq = makeAuthReq("http://localhost:3000/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "rental", amountSen: 1000 }),
    });
    const noMonthRes = await expensesPost(noMonthReq);
    expect(noMonthRes.status).toBe(400);
    expect((await noMonthRes.json()).code).toBe("saveError");

    // 2b. Missing 'amountSen': a generic validation body, NOT an invalid
    // amount. Its prose contains "amount", so the codeless fallback used to
    // render it as invalidAmount; the explicit code keeps it generic.
    const noAmountReq = makeAuthReq("http://localhost:3000/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: testMonth, type: "rental" }),
    });
    const noAmountRes = await expensesPost(noAmountReq);
    expect(noAmountRes.status).toBe(400);
    const noAmountBody = await noAmountRes.json();
    expect(noAmountBody.error).toBe("Field 'amountSen' is required");
    expect(noAmountBody.code).toBe("saveError");

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

    // 4. The Operating Expense is persisted for the month
    const persisted = await listOperatingExpenses(testMonth, { db });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(expenseId);
    expect(persisted[0].amountSen).toBe(150000);

    // 5. DELETE /api/expenses?id=...
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

    // 6. The Operating Expense is gone after deletion
    expect(await listOperatingExpenses(testMonth, { db })).toHaveLength(0);

    // 7. DELETE with a JSON `null` body is a 400, not a 500 (audit #88)
    const nullBodyRes = await expensesDelete(
      makeAuthReq("http://localhost:3000/api/expenses", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "null",
      }),
    );
    expect(nullBodyRes.status).toBe(400);
    expect(await nullBodyRes.json()).toEqual({
      error: "Valid 'id' query parameter or body field is required",
      code: "saveError",
    });

    // 8. Float / junk ids are rejected, from the query or the body
    for (const req of [
      makeAuthReq("http://localhost:3000/api/expenses?id=1.5", { method: "DELETE" }),
      makeAuthReq("http://localhost:3000/api/expenses?id=2junk", { method: "DELETE" }),
      makeAuthReq("http://localhost:3000/api/expenses", {
        method: "DELETE",
        body: JSON.stringify({ id: 0 }),
      }),
    ]) {
      const res = await expensesDelete(req);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("saveError");
    }

    // 9. Non-object and oversize POST bodies are rejected before the service
    const arrayRes = await expensesPost(
      makeAuthReq("http://localhost:3000/api/expenses", {
        method: "POST",
        body: "[]",
      }),
    );
    expect(arrayRes.status).toBe(400);
    expect((await arrayRes.json()).error).toBe("Request body must be a JSON object");

    const bigRes = await expensesPost(
      makeAuthReq("http://localhost:3000/api/expenses", {
        method: "POST",
        body: JSON.stringify({ month: testMonth, note: "x".repeat(MAX_BODY_JSON_BYTES) }),
      }),
    );
    expect(bigRes.status).toBe(413);
    expect((await bigRes.json()).code).toBe("saveError");
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

describe("9. Future-month rejection (policy: Opex cannot be dated forward)", () => {
  const MOCK_NOW = new Date("2026-09-10T12:00:00Z"); // current month in KL is 2026-09
  const PAST_MONTH = "2026-08";
  const CURRENT_MONTH = "2026-09";
  const FUTURE_MONTH = "2026-10";

  it("rejects addOperatingExpense for a future month", async () => {
    await expect(
      addOperatingExpense(FUTURE_MONTH, "rental", 10000, null, {
        db,
        now: MOCK_NOW,
      }),
    ).rejects.toThrow(ValidationError);

    await expect(
      addOperatingExpense(FUTURE_MONTH, "rental", 10000, null, {
        db,
        now: MOCK_NOW,
      }),
    ).rejects.toThrow(
      `Month "${FUTURE_MONTH}" is in the future (current month in Asia/Kuala_Lumpur is "${CURRENT_MONTH}")`,
    );

    // No row written for the rejected month
    const rows = await listOperatingExpenses(FUTURE_MONTH, { db });
    expect(rows).toHaveLength(0);
  });

  it("rejects addOperatingExpense for a far-future month against the real clock", async () => {
    await expect(
      addOperatingExpense("2099-01", "rental", 10000, null, { db }),
    ).rejects.toThrow(ValidationError);

    const rows = await listOperatingExpenses("2099-01", { db });
    expect(rows).toHaveLength(0);
  });

  it("rejects updateOperatingExpense moving an expense into a future month", async () => {
    const expense = await addOperatingExpense(
      PAST_MONTH,
      "utilities",
      4000,
      "future-move-check",
      { db, now: MOCK_NOW },
    );

    await expect(
      updateOperatingExpense(
        expense.id,
        { month: FUTURE_MONTH },
        { db, now: MOCK_NOW },
      ),
    ).rejects.toThrow(ValidationError);

    // Row is untouched
    const unchanged = db
      .select()
      .from(operatingExpenses)
      .where(eq(operatingExpenses.id, expense.id))
      .get();
    expect(unchanged?.month).toBe(PAST_MONTH);
  });

  it("allows past and current months for add and update", async () => {
    const past = await addOperatingExpense(
      PAST_MONTH,
      "rental",
      50000,
      "past-month-ok",
      { db, now: MOCK_NOW },
    );
    expect(past.month).toBe(PAST_MONTH);

    const current = await addOperatingExpense(
      CURRENT_MONTH,
      "wages",
      30000,
      "current-month-ok",
      { db, now: MOCK_NOW },
    );
    expect(current.month).toBe(CURRENT_MONTH);

    const moved = await updateOperatingExpense(
      past.id,
      { month: CURRENT_MONTH },
      { db, now: MOCK_NOW },
    );
    expect(moved.month).toBe(CURRENT_MONTH);
  });

  it("uses KL wall time, not UTC, for the future-month boundary", async () => {
    // 2026-09-30T20:00Z = 2026-10-01 04:00 KL -> "2026-10" is the CURRENT month
    // in KL (would be future if UTC date were used): must be ALLOWED.
    const klNextDay = new Date("2026-09-30T20:00:00Z");
    const allowed = await addOperatingExpense("2026-10", "rental", 10000, "kl-boundary", {
      db,
      now: klNextDay,
    });
    expect(allowed.month).toBe("2026-10");

    // 2026-09-30T15:00Z = 2026-09-30 23:00 KL -> "2026-10" is still future: rejected.
    const klSameDay = new Date("2026-09-30T15:00:00Z");
    await expect(
      addOperatingExpense("2026-10", "utilities", 4000, "kl-boundary-2", {
        db,
        now: klSameDay,
      }),
    ).rejects.toThrow(
      'Month "2026-10" is in the future (current month in Asia/Kuala_Lumpur is "2026-09")',
    );
  });
});

describe("10. Bulk delete (deleteOperatingExpenses + DELETE { ids })", () => {
  const authSession = {
    user: { id: "2", name: "katte", role: "Admin" as const },
  };

  function makeAuthReq(url: string, init?: any) {
    const req = new NextRequest(url, init);
    (req as any).auth = authSession;
    return req;
  }

  function bulkDeleteReq(body: unknown) {
    return makeAuthReq("http://localhost:3000/api/expenses", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function insertExpense(month: string, note: string) {
    return db
      .insert(operatingExpenses)
      .values({ month, type: "wages", amountSen: 1000, note })
      .returning()
      .get();
  }

  it("deletes every id in one call and counts the removed rows", async () => {
    const month = "2024-02";
    const a = insertExpense(month, "bulk a");
    const b = insertExpense(month, "bulk b");
    const keep = insertExpense(month, "bulk keep");

    const result = await deleteOperatingExpenses([a.id, b.id], { db });
    expect(result).toEqual({ deleted: 2 });

    const left = await listOperatingExpenses(month, { db });
    expect(left.map((e) => e.id)).toEqual([keep.id]);
    await removeOperatingExpense(keep.id, { db });
  });

  it("skips ids that do not exist and counts only what was removed", async () => {
    const a = insertExpense("2024-02", "bulk partial");
    const result = await deleteOperatingExpenses([a.id, 999998, 999999, a.id], {
      db,
    });
    expect(result).toEqual({ deleted: 1 });

    expect(await deleteOperatingExpenses([999999], { db })).toEqual({
      deleted: 0,
    });
  });

  it("rejects an empty array and invalid ids with a saveError ValidationError", async () => {
    await expect(deleteOperatingExpenses([], { db })).rejects.toThrow(
      ValidationError,
    );
    await expect(deleteOperatingExpenses([], { db })).rejects.toMatchObject({
      code: "saveError",
    });
    await expect(deleteOperatingExpenses([1.5], { db })).rejects.toThrow(
      ValidationError,
    );
  });

  it("deletes nothing when any row is in a closed month (single transaction)", async () => {
    // 2025-04 is closed by section 4.
    const open = insertExpense("2024-02", "bulk open");
    const closed = insertExpense("2025-04", "bulk closed");

    await expect(
      deleteOperatingExpenses([open.id, closed.id], { db }),
    ).rejects.toThrow(ClosedMonthError);

    const stillThere = db
      .select()
      .from(operatingExpenses)
      .where(eq(operatingExpenses.id, open.id))
      .get();
    expect(stillThere).toBeDefined();
    await removeOperatingExpense(open.id, { db });
  });

  it("DELETE with { ids } removes the whole group in one request", async () => {
    const month = "2024-03";
    const a = insertExpense(month, "api bulk a");
    const b = insertExpense(month, "api bulk b");

    const res = await expensesDelete(bulkDeleteReq({ ids: [a.id, b.id] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(await listOperatingExpenses(month, { db })).toHaveLength(0);

    // Ids already gone are not a 404 for the batch.
    const again = await expensesDelete(bulkDeleteReq({ ids: [a.id] }));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ deleted: 0 });
  });

  it("DELETE rejects empty, oversize and malformed ids arrays", async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => i + 1);
    for (const body of [
      { ids: [] },
      { ids: tooMany },
      { ids: "1,2" },
      { ids: [1, 0] },
      { ids: [1, 1.5] },
      { ids: [1, "2junk"] },
      { ids: [true] },
    ]) {
      const res = await expensesDelete(bulkDeleteReq(body));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("saveError");
    }

    // Exactly 50 is allowed (all missing -> nothing deleted).
    const fifty = Array.from({ length: 50 }, (_, i) => 900000 + i);
    const okRes = await expensesDelete(bulkDeleteReq({ ids: fifty }));
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ deleted: 0 });
  });

  it("DELETE maps a closed-month row in the batch to 409 and deletes nothing", async () => {
    const open = insertExpense("2024-02", "api bulk open");
    const closed = insertExpense("2025-04", "api bulk closed");

    const res = await expensesDelete(
      bulkDeleteReq({ ids: [open.id, closed.id] }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("monthClosed");
    expect(
      (await listOperatingExpenses("2024-02", { db })).some(
        (e) => e.id === open.id,
      ),
    ).toBe(true);
    await removeOperatingExpense(open.id, { db });
  });

  it("single-id DELETE ?id= keeps its existing response shape", async () => {
    const a = insertExpense("2024-03", "api single");
    const res = await expensesDelete(
      makeAuthReq(`http://localhost:3000/api/expenses?id=${a.id}`, {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.removedExpense.id).toBe(a.id);

    const missing = await expensesDelete(
      makeAuthReq(`http://localhost:3000/api/expenses?id=${a.id}`, {
        method: "DELETE",
      }),
    );
    expect(missing.status).toBe(404);
  });
});

describe("11. Operating Expense identity invariant (month, type, note)", () => {
  it("add still merges into the existing row for the same identity, NULL note included", async () => {
    const month = "2023-01";
    const a = await addOperatingExpense(month, "wages", 1000, null, { db });
    const b = await addOperatingExpense(month, "wages", 500, "  ", { db });
    const c = await addOperatingExpense(month, "wages", 200, "helper", { db });
    const d = await addOperatingExpense(month, "wages", 300, "helper", { db });

    expect(b.merged).toBe(true);
    expect(b.id).toBe(a.id);
    expect(d.merged).toBe(true);
    expect(d.id).toBe(c.id);

    const rows = await listOperatingExpenses(month, { db });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.note === null)?.amountSen).toBe(1500);
    expect(rows.find((r) => r.note === "helper")?.amountSen).toBe(500);
  });

  it("update onto another row's non-NULL identity is a saveError ValidationError and changes nothing", async () => {
    const month = "2023-02";
    const a = await addOperatingExpense(month, "rental", 1000, "stall A", { db });
    const b = await addOperatingExpense(month, "rental", 2000, "stall B", { db });

    const err = await updateOperatingExpense(
      b.id,
      { note: "stall A", amountSen: 9999 },
      { db },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe("saveError");

    const rows = await listOperatingExpenses(month, { db });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === a.id)).toMatchObject({
      note: "stall A",
      amountSen: 1000,
    });
    expect(rows.find((r) => r.id === b.id)).toMatchObject({
      note: "stall B",
      amountSen: 2000,
    });
  });

  it("update onto another row's NULL-note identity (via note, type or month) is rejected", async () => {
    const month = "2023-03";
    await addOperatingExpense(month, "utilities", 1000, null, { db });
    const noted = await addOperatingExpense(month, "utilities", 2000, "water", { db });
    const otherType = await addOperatingExpense(month, "rental", 3000, null, { db });
    const otherMonth = await addOperatingExpense("2023-04", "utilities", 4000, null, { db });

    await expect(
      updateOperatingExpense(noted.id, { note: null }, { db }),
    ).rejects.toThrow(ValidationError);
    await expect(
      updateOperatingExpense(noted.id, { note: "   " }, { db }),
    ).rejects.toThrow(ValidationError);
    await expect(
      updateOperatingExpense(otherType.id, { type: "utilities" }, { db }),
    ).rejects.toThrow(ValidationError);
    await expect(
      updateOperatingExpense(otherMonth.id, { month }, { db }),
    ).rejects.toThrow(ValidationError);

    const rows = await listOperatingExpenses(month, { db });
    expect(rows).toHaveLength(3);
  });

  it("update that keeps its own identity or moves to a free one still succeeds", async () => {
    const month = "2023-05";
    const a = await addOperatingExpense(month, "rental", 1000, null, { db });
    await addOperatingExpense(month, "rental", 2000, "kiosk", { db });

    const sameIdentity = await updateOperatingExpense(
      a.id,
      { amountSen: 1500, note: null, type: "rental" },
      { db },
    );
    expect(sameIdentity.amountSen).toBe(1500);

    const moved = await updateOperatingExpense(a.id, { note: "stall" }, { db });
    expect(moved.note).toBe("stall");

    const rows = await listOperatingExpenses(month, { db });
    expect(rows).toHaveLength(2);
  });
});
