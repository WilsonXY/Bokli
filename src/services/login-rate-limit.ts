import { eq, sql } from "drizzle-orm";
import { CredentialsSignin } from "next-auth";

import { getDb, type Db } from "@/db";
import { loginAttempts, users, type LoginAttempt, type UserRole } from "@/db/schema";
import { verifyPassword } from "@/auth/password";

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCK_MINUTES = 15;

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
 * Checks if a username is currently locked out.
 * Compares UTC ISO strings via Date parsing in TS.
 * Performs opportunistic cleanup if the lock has expired and failed_count is 0.
 */
export function checkLock(
  usernameLower: string,
  nowOrOptions?: Date | RateLimitOptions,
  dbArg?: Db,
): LockStatus {
  const { now, db } = resolveArgs(nowOrOptions, dbArg);
  const normalized = usernameLower.trim().toLowerCase();

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

  // Lock has expired.
  // Opportunistic cleanup: delete row if failed_count is 0
  if (attempt.failedCount === 0) {
    db.delete(loginAttempts)
      .where(eq(loginAttempts.usernameLower, normalized))
      .run();
  }

  return {
    isLocked: false,
    lockedUntil: null,
    remainingMinutes: 0,
  };
}

/**
 * Records a failed login attempt for a username.
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

  const attempt = db
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
  const nowIso = now.toISOString();

  if (newFailedCount >= LOGIN_MAX_ATTEMPTS) {
    const lockedUntilDate = new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60 * 1000);
    const lockedUntilIso = lockedUntilDate.toISOString();

    db.insert(loginAttempts)
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

  db.insert(loginAttempts)
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
 * Authorize credentials implementation following the spec:
 * 1. Normalize username (trim + lowercase).
 * 2. Look up user. If no user -> return null (no counter write).
 * 3. Read login_attempts row. If locked_until in the future -> throw RateLimitedError (no bcrypt).
 * 4. Verify password. If valid -> delete/reset attempts row -> return user.
 * 5. If invalid -> increment failed_count; if count >= 5 -> set locked_until = now + 15m and reset failed_count to 0.
 *    Throw RateLimitedError if locked, else return null.
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

  // 1. Look up user. If no user -> return null (no counter write)
  const user = db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${username}`)
    .get();

  if (!user) {
    return null;
  }

  // 2. Read login_attempts row. If locked_until in the future -> throw RateLimitedError
  // (do NOT run bcrypt verify — prevents brute-forcing passwords during the lock window)
  const lock = checkLock(username, { db, now });
  if (lock.isLocked) {
    throw new RateLimitedError();
  }

  // 3. Verify password
  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    const failure = recordFailure(username, { db, now });
    if (failure.isLocked) {
      throw new RateLimitedError();
    }
    return null;
  }

  // 4. If valid -> reset attempts row -> return user
  recordSuccess(username, { db });

  return {
    id: String(user.id),
    name: user.username,
    role: user.role,
  };
}
