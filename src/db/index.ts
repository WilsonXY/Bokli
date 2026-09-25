import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

/**
 * Stable database path contract: BOKLI_DB_PATH env var, required.
 * There is deliberately no default — an unset path fails closed instead of
 * silently falling back to ./data/bokli.db (the PROD DB in the prod checkout).
 * This path is the coupling point for the future Hermes backup job.
 */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const dbPath = env.BOKLI_DB_PATH?.trim();
  if (!dbPath) {
    throw new Error(
      "BOKLI_DB_PATH is not set. Refusing to guess a database path. " +
        "Set BOKLI_DB_PATH in .env.local for dev (pointing at data-dev/) " +
        "or in .env / the systemd unit for prod.",
    );
  }
  return path.resolve(dbPath);
}

export type Db = BetterSQLite3Database<typeof schema>;

export function openDb(dbPath?: string): { db: Db; sqlite: Database.Database } {
  const resolved = dbPath ? path.resolve(dbPath) : resolveDbPath();
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const sqlite = new Database(resolved);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

const dbCache = new Map<string, { db: Db; sqlite: Database.Database }>();

/**
 * Returns a cached singleton database handle for the resolved db path.
 * If the connection was closed or not yet opened, a new one is opened and cached.
 */
export function getDb(dbPath?: string): { db: Db; sqlite: Database.Database } {
  const resolved = dbPath ? path.resolve(dbPath) : resolveDbPath();
  const cached = dbCache.get(resolved);
  if (cached && cached.sqlite.open) {
    return cached;
  }
  const opened = openDb(resolved);
  dbCache.set(resolved, opened);
  return opened;
}

/**
 * Closes the cached singleton database handle for the resolved db path if open,
 * and evicts it from the cache.
 */
export function closeDb(dbPath?: string): void {
  const resolved = dbPath ? path.resolve(dbPath) : resolveDbPath();
  const cached = dbCache.get(resolved);
  if (cached) {
    if (cached.sqlite.open) {
      cached.sqlite.close();
    }
    dbCache.delete(resolved);
  }
}
