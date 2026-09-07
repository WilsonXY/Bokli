import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";

import { openDb, resolveDbPath, type Db } from "./index";

/**
 * Apply Drizzle migrations to a database.
 * Uses BOKLI_DB_PATH (default ./data/bokli.db) unless a path is given.
 */
export function runMigrations(customDbPath?: string): { db: Db } {
  const folder = path.resolve(process.cwd(), "drizzle");
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
