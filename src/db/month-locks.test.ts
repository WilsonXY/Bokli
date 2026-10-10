import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach } from "vitest";
import { monthLockCases, type LockDb } from "./month-lock-cases";

// A test-owned baseline folder lets the real native migrator apply 0000–0008.
const baseline = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-lock-baseline-"));
fs.mkdirSync(path.join(baseline, "meta"));
const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8"));
journal.entries = journal.entries.slice(0, 9);
fs.writeFileSync(path.join(baseline, "meta/_journal.json"), JSON.stringify(journal));
for (const entry of journal.entries) fs.copyFileSync(`drizzle/${entry.tag}.sql`, path.join(baseline, `${entry.tag}.sql`));

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
});
afterEach(() => sqlite.close());
afterAll(() => fs.rmSync(baseline, { recursive: true, force: true }));
const db: LockDb = {
  async run(sql, ...values) {
    const statement = sqlite.prepare(sql);
    if (statement.reader) return statement.all(...values) as Record<string, string | number | null>[];
    statement.run(...values);
    return [];
  },
  async batch(statements) { sqlite.transaction(() => statements.forEach(sql => sqlite.exec(sql)))(); },
  async baseline() { migrate(drizzle(sqlite), { migrationsFolder: baseline }); },
  async expand() { migrate(drizzle(sqlite), { migrationsFolder: "drizzle" }); },
};
monthLockCases(() => db);
