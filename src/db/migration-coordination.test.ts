import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runMigrations } from "./migrate";
import { openDb } from "./index";

let dir: string;
let dbPath: string;
beforeEach(() => {
  fs.mkdirSync("data-dev", { recursive: true });
  dir = fs.mkdtempSync(path.resolve("data-dev/migration-contract-"));
  dbPath = path.join(dir, "synthetic.db");
  runMigrations(dbPath).sqlite.close();
});
afterEach(() => {
  if (!dir.startsWith(path.resolve("data-dev") + path.sep)) throw new Error("Synthetic DB cleanup guard");
  fs.rmSync(dir, { recursive: true, force: true });
});
function futureFolder(sql = "CREATE TABLE synthetic_future(id integer);") {
  const folder = path.join(dir, "drizzle");
  fs.cpSync("drizzle", folder, { recursive: true });
  const journalPath = path.join(folder, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const previous = journal.entries.at(-1);
  journal.entries.push({ ...previous, idx: previous.idx + 1, tag: "9999_synthetic_future", when: previous.when + 1 });
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  fs.writeFileSync(path.join(folder, "9999_synthetic_future.sql"), sql);
  return folder;
}
it("refuses pending DDL during a backup and preserves schema, metadata, epoch and revision", () => {
  const { sqlite } = openDb(dbPath);
  try {
    sqlite.exec("UPDATE database_state SET backup_token='synthetic-owner'");
    const state = sqlite.prepare("SELECT * FROM database_state").get();
    expect(() => runMigrations(dbPath, { migrationsFolder: futureFolder() })).toThrow("BOKLI_SCHEMA_BUSY");
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='synthetic_future'").all()).toEqual([]);
    expect(sqlite.prepare("SELECT * FROM database_state").get()).toEqual(state);
  } finally { sqlite.close(); }
});
it("coordinates a pending migration atomically and leaves a reapply unchanged", () => {
  const { sqlite } = openDb(dbPath);
  try {
    const before = sqlite.prepare("SELECT * FROM database_state").get() as { revision: number; schema_epoch: number };
    const folder = futureFolder();
    runMigrations(dbPath, { migrationsFolder: folder }).sqlite.close();
    const after = sqlite.prepare("SELECT * FROM database_state").get() as { revision: number; schema_epoch: number; maintenance: number };
    expect(after.schema_epoch).toBe(before.schema_epoch + 1);
    expect(after.maintenance).toBe(0);
    expect(after.revision).toBeGreaterThan(before.revision);
    runMigrations(dbPath, { migrationsFolder: folder }).sqlite.close();
    expect(sqlite.prepare("SELECT * FROM database_state").get()).toEqual(after);
  } finally { sqlite.close(); }
});

it("rolls back a migration that loses a required lock trigger", () => {
  const { sqlite } = openDb(dbPath);
  try {
    const before = sqlite.prepare("SELECT * FROM database_state").get();
    expect(() => runMigrations(dbPath, { migrationsFolder: futureFolder("DROP TRIGGER daily_sheets_month_lock_update;") })).toThrow("BOKLI_SCHEMA_CONTRACT");
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='daily_sheets_month_lock_update'").all()).toHaveLength(1);
    expect(sqlite.prepare("SELECT * FROM database_state").get()).toEqual(before);
  } finally { sqlite.close(); }
});

it("preserves main's legacy expense replay after upgrade, deletion and Month Close", async () => {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { addOperatingExpense, removeOperatingExpense } = await import("../services/operating-expense");
  const baseline = path.join(dir, "baseline");
  fs.cpSync("drizzle", baseline, { recursive: true });
  const journalPath = path.join(baseline, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.slice(0, 9);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  const legacyPath = path.join(dir, "synthetic-legacy.db");
  const { sqlite, db } = openDb(legacyPath);
  try {
    migrate(db, { migrationsFolder: baseline });
    const first = await addOperatingExpense("2025-01", "rental", 1, null, { db, idempotencyKey: "legacy-owned-key" });
    await removeOperatingExpense(first.id, { db });
    sqlite.exec("INSERT INTO month_closes(month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen) VALUES('2025-01',0,0,0,0,0)");
    const receipt = sqlite.prepare("SELECT * FROM operating_expense_add_requests").get();
    const metadata = sqlite.prepare("SELECT * FROM __drizzle_migrations ORDER BY created_at").all();
    runMigrations(legacyPath).sqlite.close();
    const state = sqlite.prepare("SELECT * FROM database_state").get();
    const replay = await addOperatingExpense("2025-01", "rental", 1, null, { db, idempotencyKey: "legacy-owned-key" });
    expect(replay).toEqual({ ...first, alreadySaved: true });
    expect(sqlite.prepare("SELECT * FROM operating_expenses").all()).toEqual([]);
    expect(sqlite.prepare("SELECT * FROM operating_expense_add_requests").get()).toEqual(receipt);
    expect(sqlite.prepare("SELECT * FROM __drizzle_migrations ORDER BY created_at").all().slice(0, 9)).toEqual(metadata);
    expect(sqlite.prepare("SELECT * FROM database_state").get()).toEqual(state);
  } finally { sqlite.close(); }
});

it("restores an expanded frozen laptop under maintenance then permits existing login and migrations only after verified handoff", async () => {
  const { hashPassword } = await import("../auth/password");
  const { authenticateCredentials } = await import("../services/login-rate-limit");
  const { captureFixture, fixtureDropStatements, fixtureRestoreStatements } = await import("./image-fixtures");
  const { reverseForLegacy, assertRestoreHandoff, imageDigest } = await import("./conversion-contracts");
  const { sqlite, db } = openDb(dbPath);
  const fixture = { async run(sql: string, ...values: (string | number | null)[]) {
    const statement = sqlite.prepare(sql);
    if (statement.reader) return statement.all(...values);
    statement.run(...values); return [];
  } } as import("./contract-cases").ContractDb;
  const credentials = { username: "synthetic-restored-login", password: "synthetic-test-password" };
  try {
    sqlite.prepare("INSERT INTO users(id,username,password_hash,role) VALUES(1,?,?, 'Operator')").run(credentials.username, await hashPassword(credentials.password));
    sqlite.exec("INSERT INTO login_attempts(username_lower,failed_count,updated_at) VALUES('synthetic-restored-login',1,'2025-01-01'); INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01'),(101,'2025-02-01'); DELETE FROM daily_sheets WHERE id=101; INSERT INTO cost_lines(daily_sheet_id,category,amount_sen) VALUES(1,'gas',1); INSERT INTO month_closes(month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen) VALUES('2025-01',0,0,0,0,0); INSERT INTO month_close_events(id,month,action,at,snapshot) VALUES(88,'2025-01','close','historic','historical snapshot'); INSERT INTO mutation_receipts(user_id,operation,operation_id,payload,status,result) VALUES(1,'save-sheet','login-retained','{}',200,'{}')");
    const frozen = await captureFixture(fixture);
    sqlite.exec("UPDATE database_state SET maintenance=1,backup_token='synthetic-cloud-backup-owner' WHERE id=1");
    const cloud = await captureFixture(fixture);
    const result = await reverseForLegacy(cloud, frozen);
    sqlite.transaction(() => [...fixtureDropStatements(cloud), ...fixtureRestoreStatements(result.legacy)].forEach(sql => sqlite.exec(sql)))();
    const now = new Date("2025-03-01T00:00:00Z");
    await expect(authenticateCredentials(credentials, { db, now })).rejects.toThrow("BOKLI_MAINTENANCE");
    expect(await captureFixture(fixture)).toEqual(result.legacy);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    await assertRestoreHandoff(result.legacy, await captureFixture(fixture), {
      phase: "restore-verified", imageHash: await imageDigest(result.legacy), authorized: true, destinationOffline: true,
    });
    const state = result.legacy.tables.find(t => t.name === "database_state")!.rows[0];
    expect(sqlite.prepare("UPDATE database_state SET maintenance=0 WHERE id=1 AND maintenance=1 AND backup_token IS NULL AND revision=? AND schema_epoch=?").run(state.revision, state.schema_epoch).changes).toBe(1);
    await expect(authenticateCredentials(credentials, { db, now })).resolves.toEqual({ id: "1", name: credentials.username, role: "Operator" });
    sqlite.exec("INSERT INTO daily_sheets(date) VALUES('2025-03-01')");
    expect(sqlite.prepare("SELECT id FROM daily_sheets WHERE date='2025-03-01'").get()).toEqual({ id: 102 });
    const after = sqlite.prepare("SELECT * FROM database_state").get();
    runMigrations(dbPath).sqlite.close();
    expect(sqlite.prepare("SELECT * FROM database_state").get()).toEqual(after);
    runMigrations(dbPath, { migrationsFolder: futureFolder() }).sqlite.close();
    expect(sqlite.prepare("SELECT maintenance,backup_token,schema_epoch FROM database_state").get()).toEqual({ maintenance: 0, backup_token: null, schema_epoch: Number(state.schema_epoch)+1 });
    expect(sqlite.prepare("SELECT * FROM mutation_receipts").all()).toEqual(cloud.tables.find(t => t.name === "mutation_receipts")!.rows);
    expect(sqlite.prepare("SELECT * FROM month_close_events").all()).toEqual(cloud.tables.find(t => t.name === "month_close_events")!.rows);
    expect(() => sqlite.exec("UPDATE daily_sheets SET cash_sen=1 WHERE id=1")).toThrow("BOKLI_MONTH_LOCKED");
  } finally { sqlite.close(); }
});
