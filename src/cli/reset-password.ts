import { eq, sql } from "drizzle-orm";

import { hashPassword } from "@/auth/password";
import { openDb, type Db } from "@/db";
import { users } from "@/db/schema";

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
 * Updates a user's password in the database.
 */
export async function resetPassword(
  username: string,
  newPassword: string,
  customDb?: Db,
): Promise<{ success: boolean; username: string }> {
  if (!username) {
    throw new Error("Username is required.");
  }
  if (!newPassword) {
    throw new Error("New password cannot be empty.");
  }

  const db = customDb ?? openDb().db;
  const target = db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
    .get();

  if (!target) {
    throw new Error(`User "${username}" not found.`);
  }

  const newHash = await hashPassword(newPassword);
  db.update(users)
    .set({
      passwordHash: newHash,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(users.id, target.id))
    .run();

  return { success: true, username: target.username };
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("reset-password.ts")) {
  main();
}
