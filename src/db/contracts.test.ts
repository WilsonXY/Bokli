import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterEach, beforeEach, expect, it } from "vitest";

let db: Database.Database;
const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const migration of migrations) db.transaction(() => {
    for (const statement of migration.sql) db.exec(statement);
  })();
});
afterEach(() => db.close());

it("locks revenue-only Daily Sheet edits in a closed month at the database boundary", () => {
  db.exec(`INSERT INTO daily_sheets (date) VALUES ('2025-01-01');
    INSERT INTO month_closes (month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen)
    VALUES ('2025-01',0,0,0,0,0)`);
  expect(() => db.exec("UPDATE daily_sheets SET cash_sen=1 WHERE id=1")).toThrow("BOKLI_MONTH_LOCKED");
  expect(db.prepare("SELECT cash_sen FROM daily_sheets").get()).toEqual({ cash_sen: 0 });
});
