import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { openDb, resolveDbPath, type Db } from "./index";

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
 * Uses BOKLI_DB_PATH (default ./data/bokli.db) unless a path is given.
 */
export function runMigrations(customDbPath?: string): { db: Db } {
  const folder = resolveMigrationsFolder();
  const dbPath = customDbPath ?? resolveDbPath();
  const { db } = openDb(dbPath);
  migrate(db, { migrationsFolder: folder });
  return { db };
}

// Allow `npx tsx src/db/migrate.ts` to apply migrations directly.
if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  runMigrations();
  console.log("Migrations applied successfully.");
}
