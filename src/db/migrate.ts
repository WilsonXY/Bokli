import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readMigrationFiles } from "drizzle-orm/migrator";

import { openDb, resolveDbPath, type Db } from "./index";
import requiredGuards from "./schema-guards.json";

/**
 * Resolves the migrations folder, accounting for execution from
 * repo root or from .next/standalone.
 */
export function resolveMigrationsFolder(): string {
  const localDrizzle = path.resolve(process.cwd(), "drizzle");
  if (fs.existsSync(localDrizzle)) {
    return localDrizzle;
  }
  const rootDrizzle = path.resolve(process.cwd(), "..", "..", "drizzle");
  if (fs.existsSync(rootDrizzle)) {
    return rootDrizzle;
  }
  return localDrizzle;
}

/**
 * Apply Drizzle migrations to a database.
 * Uses BOKLI_DB_PATH (required; throws if unset) unless a path is given.
 */
export function runMigrations(
  customDbPath?: string,
  options?: { migrationsFolder?: string },
): { db: Db; sqlite: import("better-sqlite3").Database } {
  const folder = options?.migrationsFolder ?? resolveMigrationsFolder();
  const dbPath = customDbPath ?? resolveDbPath();
  const { db, sqlite } = openDb(dbPath);
  try {
    const migrations = readMigrationFiles({ migrationsFolder: folder });
    const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const expectsContracts = journal.entries.some(entry => entry.tag === "0009_cloudflare_contracts");
    // Drizzle's synchronous migrator issues its own BEGIN, so use its public
    // parser and identical metadata format inside one owned IMMEDIATE transaction.
    sqlite.transaction(() => {
      const hasState = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='database_state'").get();
      const hasMetadata = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'").get();
      const last = hasMetadata ? sqlite.prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1").get() as { created_at: number } | undefined : undefined;
      const pending = migrations.filter(m => m.folderMillis > (last?.created_at ?? -1));
      const state = hasState ? sqlite.prepare("SELECT * FROM database_state WHERE id=1").get() as { maintenance: number; backup_token: string | null } | undefined : undefined;
      if (hasState && !state) throw new Error("BOKLI_STATE_REQUIRED");
      if (state && pending.length) {
        if (state.backup_token !== null) throw new Error("BOKLI_SCHEMA_BUSY");
        sqlite.prepare("UPDATE database_state SET maintenance=1 WHERE id=1").run();
      }
      sqlite.exec("CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
      for (const migration of pending) {
        for (const statement of migration.sql) sqlite.exec(statement);
        sqlite.prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)").run(migration.hash, migration.folderMillis);
      }
      if (hasState || expectsContracts) {
        if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='database_state' AND type='table'").get()) {
          throw new Error("BOKLI_SCHEMA_CONTRACT: database_state");
        }
        for (const guard of requiredGuards) {
          const actual = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type=? AND name=?").get(guard.type, guard.name) as { sql: string } | undefined;
          if (!actual || createHash("sha256").update(actual.sql).digest("hex") !== guard.sqlHash) {
            throw new Error(`BOKLI_SCHEMA_CONTRACT: ${guard.name}`);
          }
        }
      }
      if (state && pending.length) {
        sqlite.prepare("UPDATE database_state SET schema_epoch=schema_epoch+1 WHERE id=1").run();
        sqlite.prepare("UPDATE database_state SET maintenance=? WHERE id=1").run(state.maintenance);
      }
    }).immediate();
    return { db, sqlite };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

// Allow `npx tsx src/db/migrate.ts` to apply migrations directly.
if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  runMigrations().sqlite.close();
  console.log("Migrations applied successfully.");
}
