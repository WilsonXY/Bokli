import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { CredentialsSignin } from "next-auth";

import { getDb, type Db } from "@/db";
import { loginAttempts, users, type LoginAttempt, type UserRole } from "@/db/schema";
import { verifyPassword } from "@/auth/password";

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCK_MINUTES = 15;
export const STALE_ATTEMPT_HOURS = 24;

/**
 * Constant dummy bcrypt hash (cost 10) used for unknown-username authentication attempts.
 * Ensures verification timing matches known-username verification, preventing timing attacks.
 */
export const DUMMY_BCRYPT_HASH =
  "$2b$10$4k3qerpY2./mC8KCoDeupeEoF/VFpEQeFoWo43nC5ZkcAYd318roy";

export class RateLimitedError extends CredentialsSignin {
  code = "RateLimited";

  constructor(message: string = "Too many failed attempts. Try again in 15 minutes.") {
    super(message);
    this.name = "RateLimitedError";
  }
}

export interface RateLimitOptions {
  db?: Db;
  now?: Date;
}

export interface LockStatus {
  isLocked: boolean;
  lockedUntil: string | null;
  remainingMinutes: number;
}

export interface RecordFailureResult {
  isLocked: boolean;
  lockedUntil: string | null;
  failedCount: number;
  remainingMinutes: number;
}

function resolveArgs(
  nowOrOptions?: Date | RateLimitOptions,
  dbArg?: Db,
): { now: Date; db: Db } {
  let now = new Date();
  let db: Db | undefined = dbArg;

  if (nowOrOptions instanceof Date) {
    now = nowOrOptions;
  } else if (nowOrOptions && typeof nowOrOptions === "object") {
    if (nowOrOptions.now instanceof Date) {
      now = nowOrOptions.now;
    }
    if (nowOrOptions.db) {
      db = nowOrOptions.db;
    }
  }

  if (!db) {
    db = getDb().db;
  }

  return { now, db };
}

function resolveSuccessArgs(optionsOrDb?: RateLimitOptions | Db): { db: Db } {
  let db: Db | undefined;
  if (optionsOrDb) {
    if ("select" in optionsOrDb) {
      db = optionsOrDb as Db;
    } else if ("db" in optionsOrDb && optionsOrDb.db) {
      db = optionsOrDb.db;
    }
  }
  if (!db) {
    db = getDb().db;
  }
  return { db };
}

/**
 * Opportunistically cleans up stale attempts older than STALE_ATTEMPT_HOURS (24h)
 * whose locks are either null or already expired, preventing unbounded table growth.
 */
export function cleanStaleAttempts(database: Db, now: Date): void {
  const staleCutoff = new Date(
    now.getTime() - STALE_ATTEMPT_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const nowIso = now.toISOString();

  database
    .delete(loginAttempts)
    .where(
      and(
        lt(loginAttempts.updatedAt, staleCutoff),
        or(isNull(loginAttempts.lockedUntil), lte(loginAttempts.lockedUntil, nowIso)),
      ),
    )
    .run();
}

/**
 * Checks if a username is currently locked out.
 * Compares UTC ISO strings via Date parsing in TS.
 * Opportunistically cleans stale entries (>24h).
 * Unconditionally clears lockedUntil when a lock has expired.
 */
export function checkLock(
  usernameLower: string,
  nowOrOptions?: Date | RateLimitOptions,
  dbArg?: Db,
): LockStatus {
  const { now, db } = resolveArgs(nowOrOptions, dbArg);
  const normalized = usernameLower.trim().toLowerCase();
  const nowIso = now.toISOString();

  cleanStaleAttempts(db, now);

  const attempt = db
    .select()
    .from(loginAttempts)
    .where(eq(loginAttempts.usernameLower, normalized))
    .get();

  if (!attempt || !attempt.lockedUntil) {
    return {
      isLocked: false,
      lockedUntil: null,
      remainingMinutes: 0,
    };
  }

  const lockTime = new Date(attempt.lockedUntil).getTime();
  const currentTime = now.getTime();

  if (lockTime > currentTime) {
    const diffMs = lockTime - currentTime;
    const remainingMinutes = Math.max(1, Math.ceil(diffMs / (60 * 1000)));
    return {
      isLocked: true,
      lockedUntil: attempt.lockedUntil,
      remainingMinutes,
    };
  }

  // Lock has expired: unconditionally clear lockedUntil
  db.update(loginAttempts)
    .set({
      lockedUntil: null,
      updatedAt: nowIso,
    })
    .where(eq(loginAttempts.usernameLower, normalized))
    .run();

  return {
    isLocked: false,
    lockedUntil: null,
    remainingMinutes: 0,
  };
}

/**
 * Records a failed login attempt for a username within an atomic database transaction.
 * If new failed_count >= LOGIN_MAX_ATTEMPTS (5), locks the account for LOGIN_LOCK_MINUTES (15)
 * and resets failed_count to 0.
 * If a previous lock has already expired, failures start counting from 0 again (non-cumulative).
 */
export function recordFailure(
  usernameLower: string,
  nowOrOptions?: Date | RateLimitOptions,
  dbArg?: Db,
): RecordFailureResult {
  const { now, db } = resolveArgs(nowOrOptions, dbArg);
  const normalized = usernameLower.trim().toLowerCase();
  const nowIso = now.toISOString();

  return db.transaction((tx) => {
    cleanStaleAttempts(tx as unknown as Db, now);

    const attempt = tx
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.usernameLower, normalized))
      .get();

    let currentFailedCount = 0;
    if (attempt) {
      if (attempt.lockedUntil) {
        const lockTime = new Date(attempt.lockedUntil).getTime();
        if (lockTime > now.getTime()) {
          // Still currently locked
          const diffMs = lockTime - now.getTime();
          const remainingMinutes = Math.max(1, Math.ceil(diffMs / (60 * 1000)));
          return {
            isLocked: true,
            lockedUntil: attempt.lockedUntil,
            failedCount: attempt.failedCount,
            remainingMinutes,
          };
        }
        // Previous lock has expired -> reset failure counter so attempts count from 0 again
        currentFailedCount = 0;
      } else {
        currentFailedCount = attempt.failedCount;
      }
    }

    const newFailedCount = currentFailedCount + 1;

    if (newFailedCount >= LOGIN_MAX_ATTEMPTS) {
      const lockedUntilDate = new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60 * 1000);
      const lockedUntilIso = lockedUntilDate.toISOString();

      tx.insert(loginAttempts)
        .values({
          usernameLower: normalized,
          failedCount: 0,
          lockedUntil: lockedUntilIso,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: loginAttempts.usernameLower,
          set: {
            failedCount: 0,
            lockedUntil: lockedUntilIso,
            updatedAt: nowIso,
          },
        })
        .run();

      return {
        isLocked: true,
        lockedUntil: lockedUntilIso,
        failedCount: 0,
        remainingMinutes: LOGIN_LOCK_MINUTES,
      };
    }

    tx.insert(loginAttempts)
      .values({
        usernameLower: normalized,
        failedCount: newFailedCount,
        lockedUntil: null,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: loginAttempts.usernameLower,
        set: {
          failedCount: newFailedCount,
          lockedUntil: null,
          updatedAt: nowIso,
        },
      })
      .run();

    return {
      isLocked: false,
      lockedUntil: null,
      failedCount: newFailedCount,
      remainingMinutes: 0,
    };
  });
}

/**
 * Resets the failed attempts counter on successful login.
 * Deletes the attempts row to cap table growth.
 */
export function recordSuccess(
  usernameLower: string,
  optionsOrDb?: RateLimitOptions | Db,
): void {
  const { db } = resolveSuccessArgs(optionsOrDb);
  const normalized = usernameLower.trim().toLowerCase();

  db.delete(loginAttempts)
    .where(eq(loginAttempts.usernameLower, normalized))
    .run();
}

/**
 * Retrieves the current login attempt record for a username.
 */
export function getLoginAttempt(
  usernameLower: string,
  optionsOrDb?: RateLimitOptions | Db,
): LoginAttempt | undefined {
  const { db } = resolveSuccessArgs(optionsOrDb);
  const normalized = usernameLower.trim().toLowerCase();

  return db
    .select()
    .from(loginAttempts)
    .where(eq(loginAttempts.usernameLower, normalized))
    .get();
}

/**
 * Authorize credentials implementation:
 * 1. Normalize username (trim + lowercase).
 * 2. Check lock status. If locked -> throw RateLimitedError immediately (skips bcrypt).
 * 3. Look up user in DB.
 *    - If unknown user -> run dummy bcrypt verify (timing oracle fix), record failure
 *      for that username (lock oracle fix). If locked after 5 -> throw RateLimitedError, else return null.
 * 4. If known user -> verify password with bcrypt.
 *    - If invalid -> record failure. If locked after 5 -> throw RateLimitedError, else return null.
 * 5. If valid -> reset attempts row -> return user.
 */
export async function authenticateCredentials(
  credentials: { username?: string | null; password?: string | null },
  options?: RateLimitOptions,
): Promise<{ id: string; name: string; role: UserRole } | null> {
  if (!credentials.username || !credentials.password) {
    return null;
  }

  const { now, db } = resolveArgs(options);
  const username = String(credentials.username).trim().toLowerCase();
  const password = String(credentials.password);

  // 1. Check lock status for the submitted username.
  // If locked, throw RateLimitedError immediately (skips bcrypt for both known and unknown users).
  const lock = checkLock(username, { db, now });
  if (lock.isLocked) {
    throw new RateLimitedError();
  }

  // 2. Look up user by lowercase username.
  const user = db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${username}`)
    .get();

  if (!user) {
    // Unknown username: run dummy bcrypt verify to defeat timing oracle
    await verifyPassword(password, DUMMY_BCRYPT_HASH);
    // Also record failure for unknown username to defeat lock oracle
    const failure = recordFailure(username, { db, now });
    if (failure.isLocked) {
      throw new RateLimitedError();
    }
    return null;
  }

  // 3. Known user: verify password
  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    const failure = recordFailure(username, { db, now });
    if (failure.isLocked) {
      throw new RateLimitedError();
    }
    return null;
  }

  // 4. Valid password -> reset attempts row -> return user
  recordSuccess(username, { db });

  return {
    id: String(user.id),
    name: user.username,
    role: user.role,
  };
}
