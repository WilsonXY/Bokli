import { eq, sql } from "drizzle-orm";

import { hashPassword } from "@/auth/password";
import { openDb, type Db } from "@/db";
import { users } from "@/db/schema";
import {
  clearLoginAttempts,
  MAX_USERNAME_LENGTH,
  normalizeUsername,
} from "@/services/login-rate-limit";

/**
 * Reads the password from a stream (defaults to stdin).
 * Works interactively if TTY (input masked), or via pipe/redirect.
 * The password is NOT trimmed — leading/trailing spaces are significant.
 */
export async function readPassword(
  stream: NodeJS.ReadableStream = process.stdin,
): Promise<string> {
  if (process.stdin.isTTY && stream === process.stdin) {
    // Masked input: route keystrokes through raw mode so the terminal
    // does not echo the password.
    return new Promise((resolve, reject) => {
      process.stdout.write("Enter new password: ");
      const chars: string[] = [];
      let rawModeSupported = false;
      try {
        process.stdin.setRawMode(true);
        rawModeSupported = true;
      } catch {
        // Non-TTY fallback below.
      }
      process.stdin.setEncoding("utf-8");
      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === "\r" || ch === "\n") {
            process.stdin.setRawMode?.(false);
            process.stdin.removeListener("data", onData);
            process.stdout.write("\n");
            resolve(chars.join(""));
            return;
          }
          if (ch === "\u0003") {
            // Ctrl+C
            process.stdin.setRawMode?.(false);
            process.stdin.removeListener("data", onData);
            process.stdout.write("\n");
            reject(new Error("Aborted."));
            return;
          }
          if (ch === "\u007f" || ch === "\b") {
            chars.pop();
            continue;
          }
          chars.push(ch);
        }
        // Echo a dot per character only when raw mode is active (real TTY).
        if (rawModeSupported) process.stdout.write(".");
      };
      process.stdin.on("data", onData);
    });
  }

  return new Promise((resolve, reject) => {
    let data = "";
    stream.setEncoding("utf-8");
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.on("end", () => {
      // Strip a single trailing newline added by echo/pipe, preserve other whitespace.
      resolve(data.replace(/\r?\n$/, ""));
    });
    stream.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Updates a user's password in the database and clears any login lock.
 *
 * The username is normalized with the same rules as the login path
 * (trim + lowercase, reject empty, reject >64 chars) so that ' Katte ' resolves
 * to the same account here and at sign-in. Clearing login_attempts means an
 * operator reset also unlocks a user who is mid-lockout, instead of leaving
 * them locked for the rest of the 15-minute window.
 */
export async function resetPassword(
  username: string,
  newPassword: string,
  customDb?: Db,
): Promise<{ success: boolean; username: string; lockCleared: boolean }> {
  const normalized = normalizeUsername(username);
  if (!normalized) {
    throw new Error(
      `Username is required (max ${MAX_USERNAME_LENGTH} characters after trimming).`,
    );
  }
  if (!newPassword) {
    throw new Error("New password cannot be empty.");
  }

  const db = customDb ?? openDb().db;
  const target = db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${normalized}`)
    .get();

  if (!target) {
    throw new Error(`User "${normalized}" not found.`);
  }

  const newHash = await hashPassword(newPassword);
  db.update(users)
    .set({
      passwordHash: newHash,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(users.id, target.id))
    .run();

  const lockCleared = clearLoginAttempts(normalized, db);

  return { success: true, username: target.username, lockCleared };
}

/**
 * Sessions are JWTs (ADR-0003), so changing the password hash does NOT log out
 * anyone who already holds a session cookie. Only rotating the signing secret
 * does. Audit decision #6 (2026-09-25): rotate AUTH_SECRET after every reset.
 * Full procedure: docs/runbook-password-reset.md
 */
function printRotationReminder() {
  console.log(
    [
      "",
      "Sessions are JWTs — the old password's sessions are still valid.",
      "To actually log everyone out, rotate the signing secret on prod:",
      "",
      "  1. openssl rand -base64 32",
      "  2. set BOTH AUTH_SECRET and NEXTAUTH_SECRET to that value in prod .env",
      "  3. systemctl --user restart bokli",
      "  4. smoke-test the login (see runbook §4.5)",
      "",
      "Note: this logs out EVERY user (mom included). That is expected.",
      "Runbook: docs/runbook-password-reset.md",
    ].join("\n"),
  );
}

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error("Usage: npm run reset-password -- <username>");
    process.exit(1);
  }

  try {
    const newPassword = await readPassword();
    if (!newPassword) {
      console.error("Error: New password cannot be empty.");
      process.exit(1);
    }
    const result = await resetPassword(username, newPassword);
    console.log(`Password for user "${result.username}" reset successfully.`);
    console.log(
      result.lockCleared
        ? "Login lock cleared — the account can sign in again immediately."
        : "No login lock was active — nothing to clear.",
    );
    printRotationReminder();
    // Interactive raw-mode stdin keeps the Node event loop alive after the
    // listener is removed (TTY stays open, prompt never returns). Fix verified
    // 2026-09-09 via PTY repro: unref() lets the process exit naturally.
    if (process.stdin.isTTY) {
      process.stdin.unref();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("reset-password.ts")) {
  main();
}
