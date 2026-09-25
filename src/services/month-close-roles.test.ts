import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { openDb, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { getOrCreateSheet, setRevenue } from "./daily-sheet";
import { ForbiddenError, reopenMonth } from "./month-close";
import { POST as closePost } from "../../app/api/close/route";
import { POST as reopenPost } from "../../app/api/close/reopen/route";

/**
 * Close/reopen role policy (audit decision #1, 2026-09-25):
 * - Either role may CLOSE (lock) a month — POST /api/close is withAuth only.
 * - Only Admin may REOPEN a closed month — enforced at the route (403),
 *   in the service (ForbiddenError) and in the UI.
 * These tests lock that policy in at the route level so a future change of
 * either guard fails loudly.
 */

const FORBIDDEN_MESSAGE =
  "Forbidden: Admin role required to reopen a closed month";

let tmpDir: string;
let dbPath: string;
let db: Db;
let sqlite: import("better-sqlite3").Database;
const originalDbPath = process.env.BOKLI_DB_PATH;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-close-roles-test-"));
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

const operatorSession = {
  user: { id: "1", name: "mom", role: "Operator" as const },
};
const adminSession = {
  user: { id: "2", name: "katte", role: "Admin" as const },
};

function makeAuthReq(url: string, session: any, init?: any) {
  const req = new NextRequest(url, init as any);
  (req as any).auth = session;
  return req;
}

function postJson(url: string, session: any, body: unknown) {
  return makeAuthReq(url, session, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Seed one balanced daily sheet so the month is closable with a 0 difference. */
async function seedMonth(month: string, now: Date) {
  const sheet = await getOrCreateSheet(`${month}-01`, { db, now });
  await setRevenue(sheet.id, 10000, 5000, { db });
}

describe("Close/reopen role policy — POST /api/close (any role may lock)", () => {
  it("allows an Operator to close a month", async () => {
    const MONTH = "2025-07";
    await seedMonth(MONTH, new Date("2025-07-20T12:00:00Z"));

    const res = await closePost(
      postJson("http://localhost:3000/api/close", operatorSession, {
        month: MONTH,
        cashOnHandSen: 10000,
        tngOnHandSen: 5000,
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.close.month).toBe(MONTH);
    expect(body.close.closedAt).toBeDefined();
    expect(body.balanced).toBe(true);
    expect(body.differenceSen).toBe(0);
  });

  it("allows an Admin to close a month as well", async () => {
    const MONTH = "2025-08";
    await seedMonth(MONTH, new Date("2025-08-20T12:00:00Z"));

    const res = await closePost(
      postJson("http://localhost:3000/api/close", adminSession, {
        month: MONTH,
        cashOnHandSen: 10000,
        tngOnHandSen: 5000,
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.close.month).toBe(MONTH);
    expect(body.balanced).toBe(true);
  });
});

describe("Close/reopen role policy — POST /api/close/reopen (Admin only)", () => {
  it("rejects an Operator with 403 and the exact policy message", async () => {
    const res = await reopenPost(
      postJson("http://localhost:3000/api/close/reopen", operatorSession, {
        month: "2025-07",
        reason: "Operator wants to fix a typo",
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe(FORBIDDEN_MESSAGE);
  });

  it("rejects a session with no role at all with 403", async () => {
    const res = await reopenPost(
      postJson(
        "http://localhost:3000/api/close/reopen",
        { user: { id: "3", name: "nobody" } },
        { month: "2025-07", reason: "No role attached" },
      ),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe(FORBIDDEN_MESSAGE);
  });

  it("does not reopen the month when an Operator is rejected", async () => {
    // The 403 above must be fail-closed: the close row stays closed.
    const res = await reopenPost(
      postJson("http://localhost:3000/api/close/reopen", adminSession, {
        month: "2025-07",
        reason: "Admin approved correction after Operator request",
      }),
    );

    // Succeeding here proves the month was still closed after the Operator 403
    // (reopening an already-open month is a 400 ValidationError).
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.close.month).toBe("2025-07");
    expect(body.close.reopenedAt).toBeDefined();
    expect(body.close.reopenReason).toBe(
      "Admin approved correction after Operator request",
    );
  });

  it("allows an Admin to reopen a closed month", async () => {
    const res = await reopenPost(
      postJson("http://localhost:3000/api/close/reopen", adminSession, {
        month: "2025-08",
        reason: "Missing gas expense for August",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.close.month).toBe("2025-08");
    expect(body.close.reopenedAt).toBeDefined();
    expect(body.close.reopenReason).toBe("Missing gas expense for August");
    expect(body.message).toContain("2025-08");
  });
});

describe("Close/reopen role policy — service-level guard behind the route", () => {
  it("throws ForbiddenError with the same message for a non-Admin caller", async () => {
    await expect(
      reopenMonth("2025-08", "Operator bypassing the route", {
        role: "Operator",
        db,
      }),
    ).rejects.toThrow(ForbiddenError);

    await expect(
      reopenMonth("2025-08", "Operator bypassing the route", {
        role: "Operator",
        db,
      }),
    ).rejects.toThrow(FORBIDDEN_MESSAGE);
  });

  it("throws ForbiddenError when no role is supplied at all", async () => {
    await expect(
      reopenMonth("2025-08", "No role supplied", { db }),
    ).rejects.toThrow(ForbiddenError);
  });
});
