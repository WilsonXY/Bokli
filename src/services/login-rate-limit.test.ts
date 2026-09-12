import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { openDb, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { loginAttempts, users } from "@/db/schema";
import { hashPassword } from "@/auth/password";
import {
  authenticateCredentials,
  checkLock,
  getLoginAttempt,
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_ATTEMPTS,
  RateLimitedError,
  recordFailure,
  recordSuccess,
} from "./login-rate-limit";

let tmpDir: string;
let dbPath: string;
let db: Db;
let sqlite: import("better-sqlite3").Database;
const originalDbPath = process.env.BOKLI_DB_PATH;

const MOCK_NOW = new Date("2026-09-02T12:00:00.000Z");
const MOM_PASSWORD = "mom-secure-password";

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-ratelimit-test-"));
  dbPath = path.join(tmpDir, "test.db");
  process.env.BOKLI_DB_PATH = dbPath;

  const opened = openDb(dbPath);
  db = opened.db;
  sqlite = opened.sqlite;
  runMigrations(dbPath);

  const hash = await hashPassword(MOM_PASSWORD);
  db.insert(users)
    .values({
      username: "mom",
      passwordHash: hash,
      role: "Operator",
    })
    .run();
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

beforeEach(() => {
  db.delete(loginAttempts).run();
});

describe("login rate limiter constants & error", () => {
  it("exports LOGIN_MAX_ATTEMPTS = 5 and LOGIN_LOCK_MINUTES = 15", () => {
    expect(LOGIN_MAX_ATTEMPTS).toBe(5);
    expect(LOGIN_LOCK_MINUTES).toBe(15);
  });

  it("RateLimitedError has code RateLimited", () => {
    const error = new RateLimitedError();
    expect(error.code).toBe("RateLimited");
    expect(error.message).toContain("15 minutes");
  });
});

describe("login rate limiter core unit tests", () => {
  it("checkLock returns not locked for unknown or clean user", () => {
    const status = checkLock("mom", MOCK_NOW, db);
    expect(status.isLocked).toBe(false);
    expect(status.lockedUntil).toBeNull();
    expect(status.remainingMinutes).toBe(0);
  });

  it("recordFailure increments failed_count up to 4 without locking", () => {
    for (let i = 1; i <= 4; i++) {
      const res = recordFailure("mom", MOCK_NOW, db);
      expect(res.isLocked).toBe(false);
      expect(res.failedCount).toBe(i);
      expect(res.lockedUntil).toBeNull();
    }

    const row = getLoginAttempt("mom", db);
    expect(row).toBeDefined();
    expect(row?.failedCount).toBe(4);
    expect(row?.lockedUntil).toBeNull();
  });

  it("recordFailure on 5th attempt locks for 15 minutes and resets failed_count to 0", () => {
    for (let i = 1; i <= 4; i++) {
      recordFailure("mom", MOCK_NOW, db);
    }

    const res5 = recordFailure("mom", MOCK_NOW, db);
    expect(res5.isLocked).toBe(true);
    expect(res5.failedCount).toBe(0);
    expect(res5.remainingMinutes).toBe(15);

    const expectedLockedUntil = new Date(MOCK_NOW.getTime() + 15 * 60 * 1000).toISOString();
    expect(res5.lockedUntil).toBe(expectedLockedUntil);

    const row = getLoginAttempt("mom", db);
    expect(row?.failedCount).toBe(0);
    expect(row?.lockedUntil).toBe(expectedLockedUntil);
  });

  it("checkLock computes remaining minutes accurately", () => {
    for (let i = 1; i <= 5; i++) {
      recordFailure("mom", MOCK_NOW, db);
    }

    // 5 minutes later -> 10 minutes remaining
    const plus5Min = new Date(MOCK_NOW.getTime() + 5 * 60 * 1000);
    const status5 = checkLock("mom", plus5Min, db);
    expect(status5.isLocked).toBe(true);
    expect(status5.remainingMinutes).toBe(10);

    // 14.5 minutes later -> 1 minute remaining (Math.ceil)
    const plus14_5Min = new Date(MOCK_NOW.getTime() + 14.5 * 60 * 1000);
    const status14 = checkLock("mom", plus14_5Min, db);
    expect(status14.isLocked).toBe(true);
    expect(status14.remainingMinutes).toBe(1);

    // 15 minutes later -> lock expired
    const plus15Min = new Date(MOCK_NOW.getTime() + 15 * 60 * 1000);
    const status15 = checkLock("mom", plus15Min, db);
    expect(status15.isLocked).toBe(false);
  });
});

describe("login rate limiter required spec scenarios", () => {
  // Scenario 1
  it("1. 4 failures -> 5th valid login succeeds (counter resets)", async () => {
    for (let i = 1; i <= 4; i++) {
      const res = await authenticateCredentials(
        { username: "mom", password: "wrong-password" },
        { db, now: MOCK_NOW },
      );
      expect(res).toBeNull();
    }

    const rowBefore = getLoginAttempt("mom", db);
    expect(rowBefore?.failedCount).toBe(4);

    const validRes = await authenticateCredentials(
      { username: "mom", password: MOM_PASSWORD },
      { db, now: MOCK_NOW },
    );
    expect(validRes).not.toBeNull();
    expect(validRes?.name).toBe("mom");
    expect(validRes?.role).toBe("Operator");

    // Row deleted / counter reset
    const rowAfter = getLoginAttempt("mom", db);
    expect(rowAfter).toBeUndefined();
    expect(checkLock("mom", MOCK_NOW, db).isLocked).toBe(false);
  });

  // Scenario 2
  it("2. 5 failures -> lock: 6th attempt with CORRECT password is rejected while locked", async () => {
    for (let i = 1; i <= 4; i++) {
      const res = await authenticateCredentials(
        { username: "mom", password: "wrong-password" },
        { db, now: MOCK_NOW },
      );
      expect(res).toBeNull();
    }

    // 5th failed attempt triggers lock and throws RateLimitedError
    await expect(
      authenticateCredentials(
        { username: "mom", password: "wrong-password" },
        { db, now: MOCK_NOW },
      ),
    ).rejects.toThrow(RateLimitedError);

    // 6th attempt with CORRECT password within 15 min lock is rejected
    const attemptNow = new Date(MOCK_NOW.getTime() + 5 * 60 * 1000);
    await expect(
      authenticateCredentials(
        { username: "mom", password: MOM_PASSWORD },
        { db, now: attemptNow },
      ),
    ).rejects.toThrow(RateLimitedError);
  });

  // Scenario 3
  it("3. After 15 min (mock now past lock) -> correct password succeeds", async () => {
    // Lock mom
    for (let i = 1; i <= 4; i++) {
      await authenticateCredentials(
        { username: "mom", password: "wrong-password" },
        { db, now: MOCK_NOW },
      );
    }
    await expect(
      authenticateCredentials(
        { username: "mom", password: "wrong-password" },
        { db, now: MOCK_NOW },
      ),
    ).rejects.toThrow(RateLimitedError);

    // 15 minutes and 1 second later: lock has expired
    const pastLockNow = new Date(MOCK_NOW.getTime() + 15 * 60 * 1000 + 1000);
    const loginRes = await authenticateCredentials(
      { username: "mom", password: MOM_PASSWORD },
      { db, now: pastLockNow },
    );

    expect(loginRes).not.toBeNull();
    expect(loginRes?.name).toBe("mom");
    expect(loginRes?.role).toBe("Operator");

    const row = getLoginAttempt("mom", db);
    expect(row).toBeUndefined();
  });

  // Scenario 4
  it("4. Invalid user -> no counter row created, correct-password login for that user unaffected", async () => {
    const nonexistent = "ghostuser";
    for (let i = 1; i <= 6; i++) {
      const res = await authenticateCredentials(
        { username: nonexistent, password: "some-password" },
        { db, now: MOCK_NOW },
      );
      expect(res).toBeNull();
    }

    const row = getLoginAttempt(nonexistent, db);
    expect(row).toBeUndefined();

    // Valid user mom is completely unaffected
    const momRes = await authenticateCredentials(
      { username: "mom", password: MOM_PASSWORD },
      { db, now: MOCK_NOW },
    );
    expect(momRes).not.toBeNull();
    expect(momRes?.name).toBe("mom");
  });

  // Scenario 5
  it("5. Failed attempts after lock expiry start counting from 0 again (not cumulative)", async () => {
    // Lock mom
    for (let i = 1; i <= 4; i++) {
      await authenticateCredentials(
        { username: "mom", password: "wrong-password" },
        { db, now: MOCK_NOW },
      );
    }
    await expect(
      authenticateCredentials(
        { username: "mom", password: "wrong-password" },
        { db, now: MOCK_NOW },
      ),
    ).rejects.toThrow(RateLimitedError);

    // Lock expired: 16 minutes after initial lock
    const expiredNow = new Date(MOCK_NOW.getTime() + 16 * 60 * 1000);

    // Attempt 1 after lock expiry with wrong password
    const res1 = await authenticateCredentials(
      { username: "mom", password: "wrong-password-after" },
      { db, now: expiredNow },
    );
    expect(res1).toBeNull();

    const row1 = getLoginAttempt("mom", db);
    expect(row1).toBeDefined();
    expect(row1?.failedCount).toBe(1);
    expect(row1?.lockedUntil).toBeNull();

    // Attempts 2, 3, 4 after lock expiry
    for (let i = 2; i <= 4; i++) {
      const res = await authenticateCredentials(
        { username: "mom", password: "wrong-password-after" },
        { db, now: expiredNow },
      );
      expect(res).toBeNull();
      expect(getLoginAttempt("mom", db)?.failedCount).toBe(i);
    }

    // Attempt 5 after lock expiry triggers lock again
    await expect(
      authenticateCredentials(
        { username: "mom", password: "wrong-password-after" },
        { db, now: expiredNow },
      ),
    ).rejects.toThrow(RateLimitedError);

    const row5 = getLoginAttempt("mom", db);
    expect(row5?.failedCount).toBe(0);
    expect(row5?.lockedUntil).toBe(
      new Date(expiredNow.getTime() + 15 * 60 * 1000).toISOString(),
    );
  });

  // Scenario 6
  it("6. recordSuccess resets partial counts", () => {
    // Record 3 failures directly
    recordFailure("mom", MOCK_NOW, db);
    recordFailure("mom", MOCK_NOW, db);
    recordFailure("mom", MOCK_NOW, db);

    expect(getLoginAttempt("mom", db)?.failedCount).toBe(3);

    // recordSuccess resets partial counts
    recordSuccess("mom", db);
    expect(getLoginAttempt("mom", db)).toBeUndefined();

    // Next failure starts at 1
    const nextRes = recordFailure("mom", MOCK_NOW, db);
    expect(nextRes.failedCount).toBe(1);
    expect(nextRes.isLocked).toBe(false);
  });
});
