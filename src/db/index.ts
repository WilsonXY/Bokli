import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

/**
 * Stable database path contract: BOKLI_DB_PATH env var,
 * default ./data/bokli.db relative to the project root.
 * This path is the coupling point for the future Hermes backup job.
 */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BOKLI_DB_PATH) {
    return path.resolve(env.BOKLI_DB_PATH);
  }
  // When running inside .next/standalone, process.cwd() is .next/standalone
  if (process.cwd().endsWith(path.join(".next", "standalone"))) {
    return path.resolve(process.cwd(), "..", "..", "data", "bokli.db");
  }
  return path.resolve(process.cwd(), "data", "bokli.db");
}

export type Db = BetterSQLite3Database<typeof schema>;

export function openDb(dbPath?: string): { db: Db; sqlite: Database.Database } {
  const resolved = dbPath ?? resolveDbPath();
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const sqlite = new Database(resolved);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
