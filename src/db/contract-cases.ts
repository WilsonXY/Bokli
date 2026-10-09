import { beforeEach, expect, it } from "vitest";
import { reverseForLegacy, assertRestoreHandoff, imageDigest, supportedLayout } from "./conversion-contracts";
import requiredGuards from "./schema-guards.json";
import { captureFixture, fixtureDropStatements, fixtureRestoreStatements } from "./image-fixtures";

export type SqlValue = string | number | null;
export interface ContractDb {
  run(sql: string, ...values: SqlValue[]): Promise<Record<string, SqlValue>[]>;
  batch(statements: string[]): Promise<void>;
  baseline(): Promise<void>;
  expand(): Promise<void>;
}
const close = (month: string, reopened: string = "NULL") => `INSERT INTO month_closes
  (month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen,reopened_at)
  VALUES ('${month}',0,0,0,0,0,${reopened})`;

/** The same behavior cases run against SQLite and real local workerd/D1. */
export function schemaContractCases(getDb: () => ContractDb) {
  beforeEach(async () => {
    await getDb().baseline();
  });

  it("normalizes only historical empty reopen markers without adding audit events", async () => {
    const db = getDb();
    await db.run(close("2025-01", "''"));
    await db.run(close("2025-02", "'2025-03-01'"));
    await db.run("INSERT INTO month_close_events(month,action,at,snapshot) VALUES ('2025-01','close','historic','historic snapshot')");
    const before = await db.run("SELECT * FROM month_close_events");
    await db.expand();
    expect(await db.run("SELECT month,reopened_at FROM month_closes ORDER BY month")).toEqual([
      { month: "2025-01", reopened_at: null }, { month: "2025-02", reopened_at: "2025-03-01" },
    ]);
    expect(await db.run("SELECT id,month,action,at,reason,snapshot FROM month_close_events")).toEqual(before);
    await expect(db.run(close("2025-03", "''"))).rejects.toThrow("BOKLI_EMPTY_REOPENED_AT");
    await expect(db.run("UPDATE month_closes SET reopened_at='' WHERE month='2025-02'")).rejects.toThrow("BOKLI_EMPTY_REOPENED_AT");
  });

  it("protects Month Close history against deletion and replacement while allowing explicit state updates", async () => {
    const db = getDb();
    await db.run(close("2025-01"));
    await db.run(close("2025-02", "'historic-reopen'"));
    await db.run("INSERT INTO month_close_events(month,action,at,snapshot) VALUES('2025-01','close','historic','historical snapshot')");
    await db.expand();
    const before = await captureFixture(db);
    for (const sql of [
      "DELETE FROM month_closes WHERE month='2025-01'",
      "INSERT OR REPLACE INTO month_closes(month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen) VALUES('2025-01',0,0,0,0,0)",
      "UPDATE OR REPLACE month_closes SET month='2025-01' WHERE month='2025-02'",
      "UPDATE month_closes SET id=100 WHERE month='2025-01'",
    ]) {
      await expect(db.run(sql)).rejects.toThrow("BOKLI_CLOSE_STATE_IMMUTABLE");
      expect(await captureFixture(db)).toEqual(before);
    }
    await db.run("UPDATE month_closes SET reopened_at='synthetic-reopen',reopen_reason='synthetic correction' WHERE month='2025-01'");
    await db.run("UPDATE month_closes SET reopened_at=NULL,reopen_reason=NULL WHERE month='2025-01'");
    expect(await db.run("SELECT * FROM month_close_events")).toEqual(before.tables.find(t => t.name === "month_close_events")!.rows);
  }, 30000);

  const operations = [
    "INSERT INTO daily_sheets(date) VALUES ('2025-01-02')",
    "UPDATE daily_sheets SET cash_sen=9 WHERE id=1",
    "DELETE FROM daily_sheets WHERE id=1",
    "INSERT INTO cost_lines(daily_sheet_id,amount_sen,category) VALUES(1,1,'gas')",
    "UPDATE cost_lines SET note='changed' WHERE id=1",
    "DELETE FROM cost_lines WHERE id=1",
    "INSERT INTO operating_expenses(month,type,amount_sen) VALUES('2025-01','utilities',0)",
    "UPDATE operating_expenses SET note='changed' WHERE id=1",
    "DELETE FROM operating_expenses WHERE id=1",
  ];
  for (const [i, statement] of operations.entries()) it(`blocks closed-month write ${i + 1}: ${statement.split(" ").slice(0, 3).join(" ")}`, async () => {
    const db = getDb();
    await db.run("INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01')");
    await db.run("INSERT INTO cost_lines(id,daily_sheet_id,amount_sen,category) VALUES(1,1,1,'gas')");
    await db.run("INSERT INTO operating_expenses(id,month,type,amount_sen) VALUES(1,'2025-01','rental',0)");
    await db.run(close("2025-01"));
    await db.expand();
    await expect(db.run(statement)).rejects.toThrow("BOKLI_MONTH_LOCKED");
    await db.run("UPDATE month_closes SET reopened_at='2025-02-01',reopen_reason='synthetic correction'");
    await db.run(statement);
    await db.run("UPDATE month_closes SET reopened_at=NULL,reopen_reason=NULL");
    await expect(db.run("INSERT INTO daily_sheets(date) VALUES('2025-01-03')")).rejects.toThrow("BOKLI_MONTH_LOCKED");
  });

  for (const direction of ["from", "to"]) for (const table of ["daily_sheets", "cost_lines", "operating_expenses"]) it(`guards ${table} moves ${direction} a closed month`, async () => {
    const db = getDb();
    await db.run("INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01'),(2,'2025-02-01')");
    await db.run("INSERT INTO cost_lines(id,daily_sheet_id,amount_sen,category) VALUES(1,1,1,'gas'),(2,2,1,'gas')");
    await db.run("INSERT INTO operating_expenses(id,month,type,amount_sen) VALUES(1,'2025-01','rental',0),(2,'2025-02','rental',0)");
    await db.run(close("2025-01"));
    await db.expand();
    const id = direction === "from" ? 1 : 2;
    const month = direction === "from" ? "2025-03" : "2025-01";
    const change = table === "daily_sheets" ? `date='${month}-03'` : table === "cost_lines" ? `daily_sheet_id=${id === 1 ? 2 : 1}` : `month='${month}'`;
    await expect(db.run(`UPDATE ${table} SET ${change} WHERE id=${id}`)).rejects.toThrow("BOKLI_MONTH_LOCKED");
    expect(await db.run("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("rejects unnormalized email mappings and collisions while leaving laptop credentials intact", async () => {
    const db = getDb();
    await db.expand();
    await db.run("INSERT INTO users(id,username,password_hash,role) VALUES(1,'synthetic-operator','fixture-only','Operator'),(2,'synthetic-admin','fixture-only','Admin')");
    await db.run("INSERT INTO user_email_identities(email,user_id) VALUES(lower(trim(?,char(32,9,10,11,12,13))),1)", "\t Operator@Example.invalid \r");
    expect(await db.run("SELECT email,role FROM user_email_identities JOIN users ON users.id=user_email_identities.user_id")).toEqual([{ email: 'operator@example.invalid', role: 'Operator' }]);
    await expect(db.run("INSERT INTO user_email_identities(email,user_id) VALUES(' Operator@Example.invalid ',2)")).rejects.toThrow();
    await expect(db.run("INSERT INTO user_email_identities(email,user_id) VALUES('operator@example.invalid',2)")).rejects.toThrow();
    await expect(db.run("INSERT INTO user_email_identities(email,user_id) VALUES('missing@example.invalid',999)")).rejects.toThrow();
    expect(await db.run("SELECT username,password_hash,role FROM users WHERE id=1")).toEqual([{ username: "synthetic-operator", password_hash: "fixture-only", role: "Operator" }]);
  });
  it("keeps scoped mutation receipts immutable and independent of business-row lifetimes", async () => {
    const db = getDb();
    await db.expand();
    const receipt = "INSERT INTO mutation_receipts(user_id,operation,operation_id,payload,status,result) VALUES(?, 'expense-add', 'synthetic-op', ?, 201, '{\"saved\":true}')";
    await db.run(receipt, 1, '{"month":"2025-01"}');
    await db.run(receipt, 2, '{"month":"2025-01"}');
    await expect(db.run(receipt, 1, '{"month":"2025-02"}')).rejects.toThrow();
    await expect(db.run("UPDATE mutation_receipts SET payload='{}'")).rejects.toThrow("BOKLI_RECEIPT_IMMUTABLE");
    await expect(db.run("DELETE FROM mutation_receipts")).rejects.toThrow("BOKLI_RECEIPT_IMMUTABLE");
    expect(await db.run("SELECT count(*) AS n FROM mutation_receipts")).toEqual([{ n: 2 }]);
  });

  it("protects historic audit and legacy expense receipts without rewriting their result", async () => {
    const db = getDb();
    await db.run("INSERT INTO operating_expense_add_requests(idempotency_key,month,type,amount_sen,result) VALUES('legacy-key','2025-01','rental',1,'legacy result')");
    await db.run("INSERT INTO month_close_events(month,action,at,snapshot) VALUES('2025-01','close','historic','historic snapshot')");
    await db.expand();
    await expect(db.run("DELETE FROM month_close_events")).rejects.toThrow("BOKLI_AUDIT_IMMUTABLE");
    await expect(db.run("UPDATE month_close_events SET snapshot='changed'")).rejects.toThrow("BOKLI_AUDIT_IMMUTABLE");
    await expect(db.run("DELETE FROM operating_expense_add_requests")).rejects.toThrow("BOKLI_RECEIPT_IMMUTABLE");
    await expect(db.run("UPDATE operating_expense_add_requests SET result='changed'")).rejects.toThrow("BOKLI_RECEIPT_IMMUTABLE");
    expect(await db.run("SELECT result FROM operating_expense_add_requests")).toEqual([{ result: 'legacy result' }]);
  });

  it("bumps backup revision for changed rows with unchanged totals and rolls it back on failure", async () => {
    const db = getDb();
    await db.expand();
    const state = async () => (await db.run("SELECT * FROM database_state WHERE id=1"))[0];
    const initial = await state();
    await db.run("INSERT INTO daily_sheets(date,cash_sen) VALUES('2025-01-01',10)");
    const inserted = await state();
    expect(inserted.revision).toBe(Number(initial.revision) + 1);
    await db.run("UPDATE daily_sheets SET note='changed row, same total'");
    const changed = await state();
    expect(changed.revision).toBe(Number(inserted.revision) + 1);
    await expect(db.batch([
      "UPDATE daily_sheets SET note='must roll back'",
      "INSERT INTO cost_lines(daily_sheet_id,amount_sen,category) VALUES(999,1,'gas')",
    ])).rejects.toThrow();
    expect(await state()).toEqual(changed);
    expect(await db.run("SELECT note FROM daily_sheets")).toEqual([{ note: 'changed row, same total' }]);
  });

  it("checks maintenance atomically and fences schema changes from an active backup", async () => {
    const db = getDb();
    await db.expand();
    await db.run("UPDATE database_state SET maintenance=1 WHERE id=1");
    await expect(db.run("INSERT INTO daily_sheets(date) VALUES('2025-01-01')")).rejects.toThrow("BOKLI_MAINTENANCE");
    await expect(db.run(close('2025-01'))).rejects.toThrow("BOKLI_MAINTENANCE");
    await expect(db.run("INSERT INTO mutation_receipts(user_id,operation,operation_id,payload,status,result) VALUES(1,'close-month','op','{}',200,'{}')")).rejects.toThrow("BOKLI_MAINTENANCE");
    await db.run("UPDATE database_state SET backup_token='synthetic-backup' WHERE id=1");
    await expect(db.run("UPDATE database_state SET schema_epoch=schema_epoch+1 WHERE id=1")).rejects.toThrow("BOKLI_SCHEMA_BUSY");
    await db.run("UPDATE database_state SET backup_token=NULL WHERE id=1");
    await db.run("UPDATE database_state SET schema_epoch=schema_epoch+1 WHERE id=1");
    await db.run("UPDATE database_state SET maintenance=0 WHERE id=1");
    await expect(db.run("UPDATE database_state SET schema_epoch=schema_epoch+1 WHERE id=1")).rejects.toThrow("BOKLI_SCHEMA_BUSY");
    await expect(db.run("DELETE FROM database_state")).rejects.toThrow("BOKLI_STATE_REQUIRED");
    await db.run("INSERT INTO daily_sheets(date) VALUES('2025-01-01')");
  });

  it("prevents replacement writes from bypassing locks or erasing immutable history", async () => {
    const db = getDb();
    await db.run("INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01')");
    await db.run(close('2025-01'));
    await db.run("INSERT INTO operating_expense_add_requests(idempotency_key,month,type,amount_sen,result) VALUES('legacy-key','2025-01','rental',1,'original')");
    await db.expand();
    await expect(db.run("INSERT OR REPLACE INTO daily_sheets(id,date) VALUES(1,'2025-02-01')")).rejects.toThrow("BOKLI_MONTH_LOCKED");
    await expect(db.run("INSERT OR REPLACE INTO operating_expense_add_requests(idempotency_key,month,type,amount_sen,result) VALUES('legacy-key','2025-01','rental',1,'changed')")).rejects.toThrow("BOKLI_RECEIPT_IMMUTABLE");
    await expect(db.run("INSERT OR REPLACE INTO database_state(id) VALUES(1)")).rejects.toThrow("BOKLI_STATE_REQUIRED");
  });

  it("commits state, one audit event and a scoped receipt atomically; replay cannot replace newer state", async () => {
    const db = getDb();
    await db.expand();
    const gate = "NOT EXISTS(SELECT 1 FROM mutation_receipts WHERE user_id=1 AND operation='close-month' AND operation_id='synthetic-close')";
    const commit = (payload: string, result = '{"closed":true}') => db.batch([
      `INSERT INTO month_closes(month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen) SELECT '2025-01',0,0,0,0,0 WHERE ${gate}`,
      `INSERT INTO month_close_events(month,action,at,snapshot,actor_user_id,actor_role) SELECT '2025-01','close','synthetic','{}',1,'Admin' WHERE ${gate}`,
      `INSERT INTO mutation_receipts(user_id,operation,operation_id,payload,status,result) VALUES(1,'close-month','synthetic-close','${payload}',200,'${result}')`,
    ]);
    await expect(commit('{}', 'invalid-json')).rejects.toThrow();
    expect(await db.run("SELECT * FROM month_closes")).toEqual([]);
    expect(await db.run("SELECT * FROM month_close_events")).toEqual([]);
    const before = await db.run("SELECT * FROM database_state");
    await Promise.all([commit('{}'), commit('{}')]);
    expect(await db.run("SELECT count(*) AS n FROM month_close_events")).toEqual([{ n: 1 }]);
    expect(await db.run("SELECT count(*) AS n FROM mutation_receipts")).toEqual([{ n: 1 }]);
    await db.run("UPDATE month_closes SET reopened_at='later',reopen_reason='synthetic correction'");
    const revision = await db.run("SELECT * FROM database_state");
    await commit('{}');
    expect(await db.run("SELECT * FROM database_state")).toEqual(revision);
    expect(await db.run("SELECT reopened_at FROM month_closes")).toEqual([{ reopened_at: 'later' }]);
    await expect(commit('{"different":true}')).rejects.toThrow("BOKLI_RETRY_PAYLOAD_MISMATCH");
    expect(await db.run("SELECT * FROM database_state")).toEqual(revision);
    expect(await db.run("SELECT count(*) AS n FROM month_close_events")).toEqual([{ n: 1 }]);
    expect(Number(revision[0].revision)).toBeGreaterThan(Number(before[0].revision));
  });

  for (const table of ["daily_sheets", "cost_lines", "operating_expenses"]) it(`guards replacement updates that collide with a closed ${table} row`, async () => {
    const db = getDb();
    await db.run("INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01'),(2,'2025-02-01')");
    await db.run("INSERT INTO cost_lines(id,daily_sheet_id,amount_sen,category) VALUES(1,1,1,'gas'),(2,2,1,'gas')");
    await db.run("INSERT INTO operating_expenses(id,month,type,amount_sen) VALUES(1,'2025-01','rental',0),(2,'2025-02','rental',0)");
    await db.run(close('2025-01'));
    await db.expand();
    const rows = await db.run(`SELECT * FROM ${table} ORDER BY id`);
    const state = await db.run("SELECT * FROM database_state");
    await expect(db.run(`UPDATE OR REPLACE ${table} SET id=1 WHERE id=2`)).rejects.toThrow('BOKLI_MONTH_LOCKED');
    expect(await db.run(`SELECT * FROM ${table} ORDER BY id`)).toEqual(rows);
    expect(await db.run("SELECT * FROM database_state")).toEqual(state);
    expect(await db.run("SELECT * FROM month_close_events")).toEqual([]);
  });

  const ignoredInserts = [
    ["users", "INSERT INTO users(id,username,password_hash,role) VALUES(1,'synthetic','fixture-only','Operator')", "INSERT OR IGNORE INTO users(id,username,password_hash,role) VALUES(100,'synthetic','fixture-only','Operator')"],
    ["daily_sheets", "INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01')", "INSERT OR IGNORE INTO daily_sheets(id,date) VALUES(100,'2025-01-01')"],
    ["cost_lines", "INSERT INTO cost_lines(id,daily_sheet_id,amount_sen,category) VALUES(1,1,1,'gas')", "INSERT OR IGNORE INTO cost_lines(id,daily_sheet_id,amount_sen,category) VALUES(100,1,0,'gas')"],
    ["operating_expenses", "INSERT INTO operating_expenses(id,month,type,amount_sen) VALUES(1,'2025-01','rental',0)", "INSERT OR IGNORE INTO operating_expenses(id,month,type,amount_sen) VALUES(100,'2025-01','rental',-1)"],
    ["month_closes", "INSERT INTO month_closes(id,month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen) VALUES(1,'2025-01',0,0,0,0,0)", "INSERT OR IGNORE INTO month_closes(id,month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen,cash_on_hand_sen) VALUES(100,'2025-02',0,0,0,0,0,-1)"],
    ["month_close_events", "INSERT INTO month_close_events(id,month,action,at,snapshot) VALUES(1,'2025-01','close','synthetic','{}')", "INSERT OR IGNORE INTO month_close_events(id,month,action,at,snapshot) VALUES(100,'2025-01','close','synthetic',NULL)"],
  ];
  for (const [table, seed, ignored] of ignoredInserts) it(`fences ignored ${table} inserts that advance AUTOINCREMENT metadata`, async () => {
    const db = getDb();
    await db.expand();
    if (table === 'users') {
      const autoTables = await db.run("SELECT name FROM sqlite_master WHERE type='table' AND name != 'd1_migrations' AND sql LIKE '%AUTOINCREMENT%' ORDER BY name");
      expect(autoTables.map(row => row.name)).toEqual(ignoredInserts.map(row => row[0]).sort());
    }
    if (table === 'cost_lines') await db.run("INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01')");
    await db.run(seed);
    const rows = await db.run(`SELECT * FROM ${table} ORDER BY id`);
    const before = (await db.run("SELECT revision FROM database_state"))[0].revision;
    await db.run(ignored);
    expect(await db.run(`SELECT * FROM ${table} ORDER BY id`)).toEqual(rows);
    expect(await db.run("SELECT CAST(seq AS TEXT) AS seq FROM sqlite_sequence WHERE name=?", table)).toEqual([{ seq: '100' }]);
    expect(Number((await db.run("SELECT revision FROM database_state"))[0].revision)).toBeGreaterThan(Number(before));
    const state = await db.run("SELECT * FROM database_state");
    await expect(db.batch([
      ignored.replace('VALUES(100,', 'VALUES(200,'),
      "INSERT INTO cost_lines(daily_sheet_id,amount_sen,category) VALUES(999,1,'gas')",
    ])).rejects.toThrow();
    expect(await db.run("SELECT * FROM database_state")).toEqual(state);
    expect(await db.run("SELECT CAST(seq AS TEXT) AS seq FROM sqlite_sequence WHERE name=?", table)).toEqual([{ seq: '100' }]);
  });

  it("aborts exhausted revision writes even when IGNORE or REPLACE could suppress CHECK failures", async () => {
    const db = getDb();
    await db.expand();
    await db.run("INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01')");
    await db.run("UPDATE database_state SET revision=9007199254740991");
    const state = await db.run("SELECT * FROM database_state");
    const rows = await db.run("SELECT * FROM daily_sheets");
    const sequences = await db.run("SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name");
    for (const statement of [
      "INSERT OR IGNORE INTO daily_sheets(date) VALUES('2025-01-02')",
      "INSERT OR REPLACE INTO daily_sheets(id,date) VALUES(1,'2025-01-02')",
      "UPDATE OR IGNORE daily_sheets SET note='must roll back'",
      "DELETE FROM daily_sheets",
      "INSERT OR IGNORE INTO mutation_receipts(user_id,operation,operation_id,payload,status,result) VALUES(1,'save-sheet','synthetic','{}',200,'{}')",
      "UPDATE OR IGNORE database_state SET maintenance=1",
      "UPDATE OR IGNORE database_state SET revision=9007199254740992",
      "UPDATE OR IGNORE database_state SET maintenance=NULL",
      "UPDATE OR IGNORE database_state SET maintenance=2",
      "UPDATE OR IGNORE database_state SET backup_token=' '",
      "UPDATE OR IGNORE database_state SET id=NULL",
    ]) {
      // SQLite validates an INTEGER PRIMARY KEY before invoking UPDATE triggers.
      const error = statement.endsWith('id=NULL') ? 'datatype mismatch' : 'BOKLI_STATE_RANGE';
      await expect(db.run(statement)).rejects.toThrow(error);
      expect(await db.run("SELECT * FROM database_state")).toEqual(state);
      expect(await db.run("SELECT * FROM daily_sheets")).toEqual(rows);
      expect(await db.run("SELECT * FROM mutation_receipts")).toEqual([]);
      expect(await db.run("SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name")).toEqual(sequences);
    }
  }, 30_000);

  it("aborts an exhausted schema epoch before an IGNORE migration batch can apply DDL", async () => {
    const db = getDb();
    await db.expand();
    const guard = String((await db.run("SELECT sql FROM sqlite_master WHERE name='database_state_schema_guard'"))[0].sql);
    // Synthetic imported state at the limit; restore its guard before exercising it.
    await db.batch([
      "DROP TRIGGER database_state_schema_guard",
      "UPDATE database_state SET maintenance=1,schema_epoch=9007199254740991",
      guard,
    ]);
    const before = await db.run("SELECT * FROM database_state");
    await expect(db.batch([
      "UPDATE OR IGNORE database_state SET schema_epoch=schema_epoch+1",
      "CREATE TABLE synthetic_untracked_ddl(id integer)",
    ])).rejects.toThrow('BOKLI_STATE_RANGE');
    expect(await db.run("SELECT * FROM database_state")).toEqual(before);
    expect(await db.run("SELECT name FROM sqlite_master WHERE name='synthetic_untracked_ddl'")).toEqual([]);
  });

  it("validates new audit actors without inventing actors for historic records", async () => {
    const db = getDb();
    await db.expand();
    await expect(db.run("INSERT INTO month_close_events(month,action,at,snapshot,actor_user_id,actor_role) VALUES('2025-01','reopen','synthetic','{}',1,'Operator')")).rejects.toThrow("BOKLI_AUDIT_ACTOR");
    await expect(db.run("INSERT INTO month_close_events(month,action,at,snapshot,actor_user_id) VALUES('2025-01','close','synthetic','{}',1)")).rejects.toThrow("BOKLI_AUDIT_ACTOR");
    await db.run("INSERT INTO month_close_events(month,action,at,snapshot,actor_user_id,actor_role) VALUES('2025-01','reopen','synthetic','{}',1,'Admin')");
  });

  for (const expandedSource of [false, true]) it(`pins and installs supported ${expandedSource ? '0009' : '0008'} history before guards without fabricating audit`, async () => {
    const db = getDb();
    await db.run("INSERT INTO users(id,username,password_hash,role) VALUES(1,'synthetic-source','fixture-only','Operator')");
    await db.run("INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01'),(99,'2025-02-01')");
    await db.run("INSERT INTO cost_lines(id,daily_sheet_id,amount_sen,category) VALUES(77,1,1,'gas')");
    await db.run(close('2025-01', "''"));
    await db.run(close('2025-02', "'synthetic-reopen'"));
    await db.run("INSERT INTO month_close_events(id,month,action,at,snapshot) VALUES(88,'2025-01','close','historic','historical bytes')");
    await db.run("INSERT INTO operating_expense_add_requests(idempotency_key,month,type,amount_sen,result) VALUES('source-legacy','2025-01','rental',1,'historical response')");
    if (expandedSource) {
      await db.expand();
      await db.run("INSERT INTO mutation_receipts(user_id,operation,operation_id,payload,status,result) VALUES(1,'save-sheet','source-new','{}',200,'{}')");
      await db.run("UPDATE database_state SET maintenance=1,backup_token='synthetic-source-owner' WHERE id=1");
    }
    const source = await captureFixture(db);
    const layout = await supportedLayout(source);
    expect(layout.migrations.at(-1)?.tag).toBe(expandedSource ? '0009_cloudflare_contracts' : '0008_mighty_bedlam');
    const unknown = structuredClone(source);
    unknown.tables.find(t => t.name === 'daily_sheets')!.sql += ' /* unpinned schema */';
    await expect(supportedLayout(unknown)).rejects.toThrow('Unsupported database layout');
    const missing = structuredClone(source);
    missing.tables = missing.tables.filter(t => !['d1_migrations','__drizzle_migrations'].includes(t.name));
    await expect(supportedLayout(missing)).rejects.toThrow('Migration inventory');
    const forged = structuredClone(source);
    const meta = forged.tables.find(t => ['d1_migrations','__drizzle_migrations'].includes(t.name))!;
    if (meta.name === 'd1_migrations') meta.rows[0].name = 'unknown.sql';
    else meta.rows[0].hash = 'unknown';
    await expect(supportedLayout(forged)).rejects.toThrow('Migration inventory');
    const restored = await reverseForLegacy(source, source);
    await db.batch([...fixtureDropStatements(source), ...fixtureRestoreStatements(restored.legacy)]);
    expect(await captureFixture(db)).toEqual(restored.legacy);
    await db.expand(); // pending only; 0009 metadata must not be replayed.
    expect(await db.run("SELECT id,month,action,at,reason,snapshot FROM month_close_events")).toEqual(source.tables.find(t => t.name === 'month_close_events')!.rows.map(({ id, month, action, at, reason, snapshot }) => ({ id, month, action, at, reason, snapshot })));
    expect(await db.run("SELECT * FROM cost_lines")).toEqual(source.tables.find(t => t.name === 'cost_lines')!.rows);
    expect((await db.run("SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name")).filter(r => r.name !== "d1_migrations")).toEqual(source.sequences.filter(r => r.name !== "d1_migrations"));
    expect(await db.run("PRAGMA foreign_key_check")).toEqual([]);
    if (!expandedSource) await expect(db.run("UPDATE daily_sheets SET cash_sen=1 WHERE id=1")).rejects.toThrow('BOKLI_MONTH_LOCKED');
    else await expect(db.run("INSERT INTO daily_sheets(date) VALUES('2025-03-01')")).rejects.toThrow('BOKLI_MAINTENANCE');
  }, 30000);

  it("plans an expanded frozen laptop under destination maintenance without inheriting cloud backup ownership", async () => {
    const db = getDb();
    await db.run("INSERT INTO users(id,username,password_hash,role) VALUES(1,'synthetic-restored','fixture-only','Operator')");
    await db.run("INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01'),(101,'2025-02-01')");
    await db.run("DELETE FROM daily_sheets WHERE id=101");
    await db.run("INSERT INTO cost_lines(daily_sheet_id,amount_sen,category) VALUES(1,1,'gas')");
    await db.run(close('2025-01'));
    await db.run(close('2025-02', "'synthetic-reopen'"));
    await db.run("INSERT INTO month_close_events(id,month,action,at,snapshot) VALUES(88,'2025-01','close','historic','historic snapshot')");
    await db.expand();
    await db.run("INSERT INTO mutation_receipts(user_id,operation,operation_id,payload,status,result) VALUES(1,'save-sheet','retained-receipt','{}',200,'{}')");
    const frozen = await captureFixture(db);
    await db.run("UPDATE database_state SET backup_token='synthetic-cloud-owner',maintenance=1 WHERE id=1");
    const cloud = await captureFixture(db);
    const result = await reverseForLegacy(cloud, frozen);
    const sourceState = cloud.tables.find(t => t.name === 'database_state')!.rows[0];
    expect(result.legacy.tables.find(t => t.name === 'database_state')!.rows).toEqual([{
      ...sourceState, backup_token: null, maintenance: 1, revision: Number(sourceState.revision) + 1,
    }]);
    expect(result.privateSidecar).toEqual(cloud);
    await db.batch([...fixtureDropStatements(cloud), ...fixtureRestoreStatements(result.legacy)]);
    expect(await captureFixture(db)).toEqual(result.legacy);
    await expect(db.run("INSERT INTO daily_sheets(date) VALUES('2025-03-01')")).rejects.toThrow('BOKLI_MAINTENANCE');
    await expect(db.run("INSERT INTO login_attempts(username_lower,failed_count,locked_until) VALUES('synthetic-restored',0,NULL)")).rejects.toThrow('BOKLI_MAINTENANCE');
    expect(await db.run("SELECT * FROM month_close_events")).toEqual(cloud.tables.find(t => t.name === 'month_close_events')!.rows);
    expect(await db.run("SELECT * FROM mutation_receipts")).toEqual(cloud.tables.find(t => t.name === 'mutation_receipts')!.rows);
    expect(await db.run("PRAGMA foreign_key_check")).toEqual([]);
    const verified = { phase: "restore-verified", imageHash: await imageDigest(result.legacy), authorized: true, destinationOffline: true };
    await expect(assertRestoreHandoff(result.legacy, await captureFixture(db), { ...verified, phase: 'copied' })).rejects.toThrow('Restore handoff');
    await expect(assertRestoreHandoff(result.legacy, await captureFixture(db), { ...verified, authorized: false })).rejects.toThrow('Restore handoff');
    await expect(assertRestoreHandoff(result.legacy, await captureFixture(db), { ...verified, destinationOffline: false })).rejects.toThrow('Restore handoff');
    await expect(assertRestoreHandoff(result.legacy, await captureFixture(db), { ...verified, imageHash: 'changed' })).rejects.toThrow('Restore handoff');
    const changed = await captureFixture(db);
    changed.tables.find(t => t.name === 'daily_sheets')!.rows[0].cash_sen = 7;
    await expect(assertRestoreHandoff(result.legacy, changed, verified)).rejects.toThrow('Restore handoff');
    await assertRestoreHandoff(result.legacy, await captureFixture(db), verified);
    const planned = result.legacy.tables.find(t => t.name === 'database_state')!.rows[0];
    // Same-transaction compare-and-set: stale verification cannot release a
    // destination changed by another trusted control writer.
    await db.run("UPDATE database_state SET maintenance=0 WHERE id=1 AND maintenance=1 AND backup_token IS NULL AND revision=? AND schema_epoch=?", Number(planned.revision)-1, planned.schema_epoch);
    expect((await db.run("SELECT maintenance FROM database_state"))[0].maintenance).toBe(1);
    await db.run("UPDATE database_state SET maintenance=0 WHERE id=1 AND maintenance=1 AND backup_token IS NULL AND revision=? AND schema_epoch=?", planned.revision, planned.schema_epoch);
    expect((await db.run("SELECT revision FROM database_state"))[0].revision).toBe(Number(planned.revision)+1);
    await db.run("INSERT INTO login_attempts(username_lower,failed_count) VALUES('synthetic-restored',0)");
    await db.run("INSERT INTO daily_sheets(date) VALUES('2025-03-01')");
    expect(await db.run("SELECT id FROM daily_sheets WHERE date='2025-03-01'")).toEqual([{ id: 102 }]);
    await expect(db.run("UPDATE daily_sheets SET cash_sen=1 WHERE id=1")).rejects.toThrow('BOKLI_MONTH_LOCKED');
    await db.batch(["UPDATE database_state SET maintenance=1 WHERE id=1", "CREATE TABLE synthetic_after_handoff(id integer)", "UPDATE database_state SET schema_epoch=schema_epoch+1 WHERE id=1", "UPDATE database_state SET maintenance=0 WHERE id=1"]);
    expect((await db.run("SELECT schema_epoch,maintenance,backup_token FROM database_state"))[0]).toEqual({ schema_epoch: Number(planned.schema_epoch)+1, maintenance: 0, backup_token: null });
    expect(await db.run("SELECT * FROM mutation_receipts")).toEqual(cloud.tables.find(t => t.name === 'mutation_receipts')!.rows);
    expect(await db.run("SELECT * FROM month_close_events")).toEqual(cloud.tables.find(t => t.name === 'month_close_events')!.rows);
  }, 30000);

  it("imports before expansion and reverse-projects metadata, NULLs, audit, children and high-water marks", async () => {
    const db = getDb();
    await db.run("INSERT INTO users(id,username,password_hash,role) VALUES(1,'synthetic-operator','fixture-only','Operator')");
    await db.run("INSERT INTO daily_sheets(id,date,note) VALUES(1,'2025-01-01',NULL),(101,'2025-02-01','deleted high ID')");
    await db.run("DELETE FROM daily_sheets WHERE id=101");
    await db.run("INSERT INTO cost_lines(id,daily_sheet_id,amount_sen,category,note) VALUES(1,1,1,'gas',NULL),(99,1,2,'gas','deleted high ID')");
    await db.run("DELETE FROM cost_lines WHERE id=99");
    await db.run(close('2025-01', "''"));
    await db.run("INSERT INTO month_close_events(id,month,action,at,snapshot) VALUES(88,'2025-01','close','historic','unchanged snapshot')");
    await db.run("INSERT INTO operating_expense_add_requests(idempotency_key,month,type,amount_sen,result) VALUES('legacy-key','2025-01','rental',1,'historic result')");
    const frozen = await captureFixture(db);
    await db.expand();
    await db.run("INSERT INTO mutation_receipts(user_id,operation,operation_id,payload,status,result) VALUES(1,'save-sheet','new-receipt','{}',200,'{}')");
    const expanded = await captureFixture(db);
    const projection = await reverseForLegacy(expanded, frozen);
    expect(projection.privateSidecar).toEqual(expanded);
    expect(projection.legacy.tables.find(t => t.name === 'mutation_receipts')).toBeUndefined();
    expect(projection.legacy.tables.find(t => t.name === 'month_close_events')?.rows).toEqual(frozen.tables.find(t => t.name === 'month_close_events')?.rows);
    expect(projection.legacy.tables.find(t => t.name === 'operating_expense_add_requests')?.rows).toEqual(frozen.tables.find(t => t.name === 'operating_expense_add_requests')?.rows);
    await db.batch([...fixtureDropStatements(expanded), ...fixtureRestoreStatements(projection.legacy)]);
    expect(await captureFixture(db)).toEqual(projection.legacy);
    expect(await db.run("PRAGMA foreign_key_check")).toEqual([]);
    // Actual restored baseline is then re-expanded: history is still imported
    // before the guards, and migration metadata allows only pending expansion.
    await db.expand();
    await expect(db.run("UPDATE daily_sheets SET cash_sen=1 WHERE id=1")).rejects.toThrow('BOKLI_MONTH_LOCKED');
    expect(await db.run("SELECT * FROM cost_lines")).toEqual(expanded.tables.find(t => t.name === 'cost_lines')?.rows);
    await db.run("INSERT INTO daily_sheets(date) VALUES('2025-03-01')");
    expect(await db.run("SELECT id FROM daily_sheets WHERE date='2025-03-01'")).toEqual([{ id: 102 }]);
  });

  it("restores exact signed-64-bit sequence marks through the pinned reverse layout", async () => {
    const db = getDb();
    await db.run("INSERT INTO users(id,username,password_hash,role) VALUES(1,'synthetic-sequence','fixture-only','Operator')");
    await db.run("UPDATE sqlite_sequence SET seq=9223372036854775800 WHERE name='users'");
    const frozen = await captureFixture(db);
    await db.expand();
    await db.run("UPDATE database_state SET maintenance=1 WHERE id=1");
    await db.run("UPDATE sqlite_sequence SET seq=9223372036854775806 WHERE name='users'");
    const source = await captureFixture(db);
    const restored = await reverseForLegacy(source, frozen);
    expect(restored.legacy.sequences.find(s => s.name === 'users')!.seq).toBe('9223372036854775806');
    await db.batch([...fixtureDropStatements(source), ...fixtureRestoreStatements(restored.legacy)]);
    expect(await db.run("SELECT CAST(seq AS TEXT) AS seq FROM sqlite_sequence WHERE name='users'")).toEqual([{ seq: '9223372036854775806' }]);
    expect(await captureFixture(db)).toEqual(restored.legacy);
  }, 30000);

  it("rebuilds a parent and child together without FK-off pragmas, losing rows, guards or sequence marks", async () => {
    const db = getDb();
    await db.run("INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01'),(101,'2025-02-01')");
    await db.run("DELETE FROM daily_sheets WHERE id=101");
    await db.run("INSERT INTO cost_lines(id,daily_sheet_id,amount_sen,category) VALUES(1,1,1,'gas'),(99,1,1,'gas')");
    await db.run("DELETE FROM cost_lines WHERE id=99");
    await db.run(close('2025-01'));
    await db.expand();
    const before = await captureFixture(db);
    const parents = before.tables.find(t => t.name === 'daily_sheets')!;
    const children = before.tables.find(t => t.name === 'cost_lines')!;
    const objects = before.objects.filter(o => /^(daily_sheets_|cost_lines_|uq_daily_sheets_date$|ix_cost_lines_sheet$)/.test(o.name));
    await db.batch([
      "UPDATE database_state SET maintenance=1 WHERE id=1",
      "UPDATE database_state SET schema_epoch=schema_epoch+1 WHERE id=1",
      ...objects.filter(o => o.type === 'trigger').map(o => `DROP TRIGGER ${o.name}`),
      parents.sql.replaceAll('"daily_sheets"', '"rebuild_sheets"').replace('`daily_sheets`', '`rebuild_sheets`'),
      children.sql.replaceAll('"cost_lines"', '"rebuild_lines"').replaceAll('"daily_sheets"', '"rebuild_sheets"').replace('`cost_lines`', '`rebuild_lines`').replace('`daily_sheets`', '`rebuild_sheets`'),
      "INSERT INTO rebuild_sheets SELECT * FROM daily_sheets",
      "INSERT INTO rebuild_lines SELECT * FROM cost_lines",
      "DROP TABLE cost_lines",
      "DROP TABLE daily_sheets",
      "ALTER TABLE rebuild_sheets RENAME TO daily_sheets",
      "ALTER TABLE rebuild_lines RENAME TO cost_lines",
      ...before.sequences.filter(s => ['daily_sheets','cost_lines'].includes(s.name)).map(s => `UPDATE sqlite_sequence SET seq=${s.seq} WHERE name='${s.name}'`),
      ...objects.map(o => o.sql),
      "UPDATE database_state SET maintenance=0 WHERE id=1",
    ]);
    expect(await db.run("SELECT * FROM daily_sheets")).toEqual(parents.rows);
    expect(await db.run("SELECT * FROM cost_lines")).toEqual(children.rows);
    expect(await db.run("SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence WHERE name IN ('daily_sheets','cost_lines') ORDER BY name")).toEqual(before.sequences.filter(s => ['daily_sheets','cost_lines'].includes(s.name)));
    await expect(db.run("UPDATE daily_sheets SET cash_sen=1 WHERE id=1")).rejects.toThrow('BOKLI_MONTH_LOCKED');
    await expect(db.run("DELETE FROM cost_lines WHERE id=1")).rejects.toThrow('BOKLI_MONTH_LOCKED');
    expect(await db.run("PRAGMA foreign_key_check")).toEqual([]);
    const after = await captureFixture(db);
    expect(after.objects).toEqual(before.objects);
  });

  it("retains the exact index and guard inventory used by migration safety checks", async () => {
    const db = getDb();
    await db.expand();
    const objects = await db.run("SELECT type,name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name");
    const actual = [];
    for (const object of objects) {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(object.sql)));
      const sqlHash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2,'0')).join('');
      actual.push({ type: object.type, name: object.name, sqlHash });
    }
    expect(actual).toEqual(requiredGuards);
  });

  it("tracks every mutable application table in the same transaction", async () => {
    const db = getDb();
    await db.expand();
    const statements = [
      "INSERT INTO users(id,username,password_hash,role) VALUES(1,'synthetic','fixture-only','Operator')",
      "UPDATE users SET role='Admin' WHERE id=1",
      "INSERT INTO user_email_identities(email,user_id) VALUES('synthetic@example.invalid',1)",
      "UPDATE user_email_identities SET email='renamed@example.invalid'",
      "DELETE FROM user_email_identities",
      "INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01')",
      "INSERT INTO cost_lines(daily_sheet_id,amount_sen,category) VALUES(1,1,'gas')",
      "UPDATE cost_lines SET note='synthetic'",
      "DELETE FROM cost_lines",
      "UPDATE daily_sheets SET note='synthetic'",
      "DELETE FROM daily_sheets",
      "INSERT INTO operating_expenses(month,type,amount_sen) VALUES('2025-01','rental',0)",
      "UPDATE operating_expenses SET note='synthetic'",
      "DELETE FROM operating_expenses",
      "INSERT INTO month_closes(month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen) VALUES('2025-01',0,0,0,0,0)",
      "UPDATE month_closes SET reopened_at='synthetic',reopen_reason='synthetic'",
      "INSERT INTO month_close_events(month,action,at,snapshot) VALUES('2025-01','close','synthetic','{}')",
      "INSERT INTO login_attempts(username_lower) VALUES('synthetic')",
      "UPDATE login_attempts SET failed_count=1",
      "DELETE FROM login_attempts",
      "INSERT INTO operating_expense_add_requests(idempotency_key,month,type,amount_sen,result) VALUES('synthetic','2025-01','rental',0,'{}')",
      "INSERT INTO mutation_receipts(user_id,operation,operation_id,payload,status,result) VALUES(1,'save-sheet','synthetic','{}',200,'{}')",
      "DELETE FROM users WHERE id=1",
    ];
    for (const statement of statements) {
      const before = (await db.run("SELECT revision FROM database_state WHERE id=1"))[0].revision;
      await db.run(statement);
      expect((await db.run("SELECT revision FROM database_state WHERE id=1"))[0].revision).toBe(Number(before)+1);
    }
    // Receipt has no identity FK and still survives deletion of the identity.
    expect(await db.run("SELECT user_id FROM mutation_receipts")).toEqual([{ user_id: 1 }]);
  // 69 serial local D1 calls: allow runner latency without weakening assertions.
  }, 30_000);

  it("fences a D1-compatible DDL batch from backup capture and rolls metadata/control changes back", async () => {
    const db = getDb();
    await db.expand();
    await db.run("UPDATE database_state SET backup_token='synthetic-owner' WHERE id=1");
    const before = await db.run("SELECT * FROM database_state");
    const ddl = [
      "UPDATE database_state SET maintenance=1 WHERE id=1",
      "UPDATE database_state SET schema_epoch=schema_epoch+1 WHERE id=1",
      "CREATE TABLE synthetic_schema_bookkeeping(schema_epoch integer)",
      "INSERT INTO synthetic_schema_bookkeeping SELECT schema_epoch FROM database_state WHERE id=1",
      "UPDATE database_state SET maintenance=0 WHERE id=1",
    ];
    await expect(db.batch(ddl)).rejects.toThrow('BOKLI_SCHEMA_BUSY');
    expect(await db.run("SELECT name FROM sqlite_master WHERE name='synthetic_schema_bookkeeping'")).toEqual([]);
    expect(await db.run("SELECT * FROM database_state")).toEqual(before);
    await db.run("UPDATE database_state SET backup_token=NULL WHERE id=1 AND backup_token='synthetic-owner'");
    await db.batch(ddl);
    expect(await db.run("SELECT * FROM synthetic_schema_bookkeeping")).toEqual([{ schema_epoch: 2 }]);
    expect((await db.run("SELECT maintenance,schema_epoch FROM database_state"))[0]).toEqual({ maintenance: 0, schema_epoch: 2 });
  });

  it("applies maintenance to all nine business write operations", async () => {
    const db = getDb();
    await db.expand();
    await db.run("INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01')");
    await db.run("INSERT INTO cost_lines(id,daily_sheet_id,amount_sen,category) VALUES(1,1,1,'gas')");
    await db.run("INSERT INTO operating_expenses(id,month,type,amount_sen) VALUES(1,'2025-01','rental',0)");
    await db.run("UPDATE database_state SET maintenance=1 WHERE id=1");
    const state = await db.run("SELECT * FROM database_state");
    for (const statement of operations) await expect(db.run(statement)).rejects.toThrow('BOKLI_MAINTENANCE');
    expect(await db.run("SELECT * FROM database_state")).toEqual(state);
  });

}
