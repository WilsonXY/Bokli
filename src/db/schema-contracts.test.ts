import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterEach, beforeEach } from "vitest";
import { schemaContractCases, type ContractDb } from "./contract-cases";
import baseline from "../../drizzle/bootstrap-baseline.json";

let sqlite: Database.Database;
const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
});
afterEach(() => sqlite.close());
async function apply(start: number, end: number) {
  sqlite.transaction(() => {
    sqlite.exec("CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
    for (const migration of migrations.slice(start, end)) {
      if (sqlite.prepare("SELECT 1 FROM __drizzle_migrations WHERE created_at=?").get(migration.folderMillis)) continue;
      for (const sql of migration.sql) sqlite.exec(sql);
      sqlite.prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)").run(migration.hash, migration.folderMillis);
    }
  })();
}
const db: ContractDb = {
  async run(sql, ...values) {
    const statement = sqlite.prepare(sql);
    if (statement.reader) return statement.all(...values) as Record<string, string | number | null>[];
    statement.run(...values);
    return [];
  },
  async batch(statements) { sqlite.transaction(() => statements.forEach(sql => sqlite.exec(sql)))(); },
  baseline: () => apply(0, baseline.migrations.length),
  expand: () => apply(baseline.migrations.length, migrations.length),
};
schemaContractCases(() => db);
