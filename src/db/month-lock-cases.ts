import { beforeEach, expect, it } from "vitest";

export type SqlValue = string | number | null;
export interface LockDb {
  run(sql: string, ...values: SqlValue[]): Promise<Record<string, SqlValue>[]>;
  batch(statements: string[]): Promise<void>;
  baseline(): Promise<void>;
  expand(): Promise<void>;

}

const close = (month: string, reopened = "NULL") => `INSERT INTO month_closes
  (month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen,reopened_at)
  VALUES ('${month}',0,0,0,0,0,${reopened})`;

// Shared behavior assertions run against SQLite and real local workerd/D1.
export function monthLockCases(getDb: () => LockDb) {
  beforeEach(async () => { await getDb().baseline(); });

  it("normalizes historical empty reopen markers without changing snapshots or audit", async () => {
    const db = getDb();
    await db.run(close("2025-01", "''"));
    await db.run(close("2025-02", "'2025-03-01'"));
    await db.run("INSERT INTO month_close_events(month,action,at,snapshot) VALUES('2025-01','close','historic','historic snapshot')");
    const audit = await db.run("SELECT * FROM month_close_events");
    const snapshots = await db.run("SELECT month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen,closed_at FROM month_closes ORDER BY month");
    await db.expand();
    expect(await db.run("SELECT month,reopened_at FROM month_closes ORDER BY month")).toEqual([
      { month: "2025-01", reopened_at: null }, { month: "2025-02", reopened_at: "2025-03-01" },
    ]);
    expect(await db.run("SELECT * FROM month_close_events")).toEqual(audit);
    expect(await db.run("SELECT month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen,closed_at FROM month_closes ORDER BY month")).toEqual(snapshots);
    await expect(db.run(close("2025-03", "''"))).rejects.toThrow("BOKLI_EMPTY_REOPENED_AT");
    await expect(db.run("UPDATE month_closes SET reopened_at='' WHERE month='2025-02'")).rejects.toThrow("BOKLI_EMPTY_REOPENED_AT");
  });
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
    const before = await db.run(`SELECT * FROM ${table} ORDER BY id`);
    await expect(db.run(`UPDATE ${table} SET ${change} WHERE id=${id}`)).rejects.toThrow("BOKLI_MONTH_LOCKED");
    expect(await db.run(`SELECT * FROM ${table} ORDER BY id`)).toEqual(before);
    expect(await db.run("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("locks a revenue-only sheet with no Cost Lines", async () => {
    const db = getDb();
    await db.expand();
    await db.run("INSERT INTO daily_sheets(date) VALUES('2025-01-01')");
    await db.run(close("2025-01"));
    await expect(db.run("UPDATE daily_sheets SET tng_sen=7 WHERE id=1")).rejects.toThrow("BOKLI_MONTH_LOCKED");
    expect(await db.run("SELECT cash_sen,tng_sen FROM daily_sheets")).toEqual([{ cash_sen: 0, tng_sen: 0 }]);
  });

  for (const table of ["daily_sheets", "cost_lines", "operating_expenses"]) it(`protects displaced closed ${table} rows under INSERT/UPDATE OR REPLACE`, async () => {
    const db = getDb();
    await db.run("INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01'),(2,'2025-02-01')");
    await db.run("INSERT INTO cost_lines(id,daily_sheet_id,amount_sen,category) VALUES(1,1,1,'gas'),(2,2,1,'gas')");
    await db.run("INSERT INTO operating_expenses(id,month,type,amount_sen) VALUES(1,'2025-01','rental',0),(2,'2025-02','rental',0)");
    await db.run(close("2025-01"));
    await db.expand();
    const rows = await db.run(`SELECT * FROM ${table} ORDER BY id`);
    const insert = table === "daily_sheets" ? "INSERT OR REPLACE INTO daily_sheets(id,date) VALUES(1,'2025-03-01')"
      : table === "cost_lines" ? "INSERT OR REPLACE INTO cost_lines(id,daily_sheet_id,amount_sen,category) VALUES(1,2,2,'gas')"
      : "INSERT OR REPLACE INTO operating_expenses(id,month,type,amount_sen) VALUES(1,'2025-03','rental',2)";
    for (const statement of [insert, `UPDATE OR REPLACE ${table} SET id=1 WHERE id=2`]) {
      await expect(db.run(statement)).rejects.toThrow("BOKLI_MONTH_LOCKED");
      expect(await db.run(`SELECT * FROM ${table} ORDER BY id`)).toEqual(rows);
    }
    if (table === "daily_sheets") {
      await expect(db.run("INSERT OR REPLACE INTO daily_sheets(date) VALUES('2025-01-01')")).rejects.toThrow("BOKLI_MONTH_LOCKED");
      await expect(db.run("UPDATE OR REPLACE daily_sheets SET date='2025-01-01' WHERE id=2")).rejects.toThrow("BOKLI_MONTH_LOCKED");
    }
    if (table === "operating_expenses") {
      await expect(db.run("INSERT OR REPLACE INTO operating_expenses(month,type,amount_sen) VALUES('2025-01','rental',3)")).rejects.toThrow("BOKLI_MONTH_LOCKED");
      await expect(db.run("UPDATE OR REPLACE operating_expenses SET month='2025-01' WHERE id=2")).rejects.toThrow("BOKLI_MONTH_LOCKED");
    }
    expect(await db.run("SELECT * FROM month_close_events")).toEqual([]);
    expect(await db.run("PRAGMA foreign_key_check")).toEqual([]);
  });
  it("protects closed and reopened Month Close identity/history from deletion and replacement", async () => {
    const db = getDb();
    await db.run(close("2025-01"));
    await db.run(close("2025-02", "'historic-reopen'"));
    await db.expand();
    const before = await db.run("SELECT * FROM month_closes ORDER BY id");
    for (const statement of [
      "DELETE FROM month_closes WHERE month='2025-01'",
      "DELETE FROM month_closes WHERE month='2025-02'",
      "INSERT OR REPLACE INTO month_closes(month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen) VALUES('2025-01',0,0,0,0,0)",
      "INSERT OR REPLACE INTO month_closes(id,month,revenue_sen,daily_cost_sen,gross_sen,operating_sen,net_sen) VALUES(1,'2025-03',0,0,0,0,0)",
      "UPDATE OR REPLACE month_closes SET month='2025-01' WHERE month='2025-02'",
      "UPDATE OR REPLACE month_closes SET id=1 WHERE id=2",
      "UPDATE month_closes SET id=100 WHERE month='2025-01'",
      "UPDATE month_closes SET month='2025-03' WHERE month='2025-02'",
    ]) {
      await expect(db.run(statement)).rejects.toThrow("BOKLI_CLOSE_STATE_IMMUTABLE");
      expect(await db.run("SELECT * FROM month_closes ORDER BY id")).toEqual(before);
    }
    // The existing close service maps UNIQUE to ClosedMonthError.
    await expect(db.run(close("2025-01"))).rejects.toThrow("UNIQUE");
    await db.run("UPDATE month_closes SET reopened_at='later',reopen_reason='synthetic correction' WHERE month='2025-01'");
    await db.run("UPDATE month_closes SET reopened_at=NULL,reopen_reason=NULL WHERE month='2025-01'");
    expect(await db.run("SELECT * FROM month_close_events")).toEqual([]);
  });

  for (const [table, seed, change, marker] of [
    ["month_close_events", "INSERT INTO month_close_events(id,month,action,at,snapshot) VALUES(1,'2025-01','close','historic','historical snapshot')", "snapshot='changed'", "BOKLI_AUDIT_IMMUTABLE"],
    ["operating_expense_add_requests", "INSERT INTO operating_expense_add_requests(idempotency_key,month,type,amount_sen,result) VALUES('legacy-key','2025-01','rental',1,'legacy result')", "result='changed'", "BOKLI_RECEIPT_IMMUTABLE"],
  ]) it(`preserves historical ${table} rows against update/delete/replacement`, async () => {
    const db = getDb();
    await db.run(seed);
    await db.expand();
    const before = await db.run(`SELECT * FROM ${table}`);
    for (const statement of [`UPDATE ${table} SET ${change}`, `DELETE FROM ${table}`, seed.replace("INSERT INTO", "INSERT OR REPLACE INTO")]) {
      await expect(db.run(statement)).rejects.toThrow(marker);
      expect(await db.run(`SELECT * FROM ${table}`)).toEqual(before);
    }
    await db.expand();
    expect(await db.run(`SELECT * FROM ${table}`)).toEqual(before);
  });

  it("reapplies the fully migrated schema without changing rows, objects or migration metadata", async () => {
    const db = getDb();
    await db.expand();
    await db.run("INSERT INTO daily_sheets(date) VALUES('2025-01-01')");
    await db.run(close("2025-01"));
    const meta = String((await db.run("SELECT name FROM sqlite_master WHERE name IN ('__drizzle_migrations','d1_migrations')"))[0].name);
    const before = await db.run(`SELECT * FROM ${meta} ORDER BY id`);
    expect(before).toHaveLength(10);
    const rows = await db.run("SELECT * FROM daily_sheets");
    const objects = await db.run("SELECT type,name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name");
    expect(objects.filter(row => row.type === "trigger")).toHaveLength(23);
    await db.expand();
    expect(await db.run(`SELECT * FROM ${meta} ORDER BY id`)).toEqual(before);
    expect(await db.run("SELECT * FROM daily_sheets")).toEqual(rows);
    expect(await db.run("SELECT type,name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name")).toEqual(objects);
    await expect(db.run("DELETE FROM daily_sheets")).rejects.toThrow("BOKLI_MONTH_LOCKED");
  });

  it("rolls back a write and audit together on a lock or FK failure", async () => {
    const db = getDb();
    await db.expand();
    await db.run("INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01')");
    await db.run(close("2025-01"));
    for (const failure of [
      "INSERT INTO cost_lines(daily_sheet_id,amount_sen,category) VALUES(999,1,'gas')",
      "UPDATE daily_sheets SET cash_sen=1 WHERE id=1",
    ]) {
      await expect(db.batch([
        "INSERT INTO daily_sheets(date) VALUES('2025-02-01')",
        "INSERT INTO month_close_events(month,action,at,snapshot) VALUES('2025-02','close','synthetic','{}')",
        failure,
      ])).rejects.toThrow();
      expect(await db.run("SELECT date FROM daily_sheets")).toEqual([{ date: "2025-01-01" }]);
      expect(await db.run("SELECT * FROM month_close_events")).toEqual([]);
      expect(await db.run("PRAGMA foreign_key_check")).toEqual([]);
    }
  });

  it("commits close/reopen/reclose with one audit each and rolls back a failed audit batch", async () => {
    const db = getDb();
    await db.expand();
    await db.batch([close("2025-01"), "INSERT INTO month_close_events(month,action,at,snapshot) SELECT month,'close',closed_at,'original snapshot' FROM month_closes"]);
    await db.batch([
      "UPDATE month_closes SET reopened_at='later',reopen_reason='synthetic correction'",
      "INSERT INTO month_close_events(month,action,at,reason,snapshot) SELECT month,'reopen',reopened_at,reopen_reason,'reopened snapshot' FROM month_closes",
    ]);
    const before = await db.run("SELECT * FROM month_closes");
    await expect(db.batch([
      "UPDATE month_closes SET reopened_at=NULL,reopen_reason=NULL,revenue_sen=1,gross_sen=1,net_sen=1",
      "INSERT INTO month_close_events(month,action,at,snapshot) VALUES('2025-01','invalid','later','invalid snapshot')",
    ])).rejects.toThrow();
    expect(await db.run("SELECT * FROM month_closes")).toEqual(before);
    await db.batch([
      "UPDATE month_closes SET reopened_at=NULL,reopen_reason=NULL,revenue_sen=1,gross_sen=1,net_sen=1",
      "INSERT INTO month_close_events(month,action,at,snapshot) SELECT month,'close',closed_at,'new snapshot' FROM month_closes",
    ]);
    await expect(db.batch([close("2025-01"), "INSERT INTO month_close_events(month,action,at,snapshot) VALUES('2025-01','close','later','duplicate')"])).rejects.toThrow("UNIQUE");
    expect(await db.run("SELECT action,snapshot FROM month_close_events ORDER BY id")).toEqual([
      { action: "close", snapshot: "original snapshot" }, { action: "reopen", snapshot: "reopened snapshot" }, { action: "close", snapshot: "new snapshot" },
    ]);
  });

  it("retains the legacy expense receipt after deleting its result row and later closing the month", async () => {
    const db = getDb();
    await db.expand();
    await db.batch([
      "INSERT INTO operating_expenses(id,month,type,amount_sen) VALUES(1,'2025-01','rental',1)",
      `INSERT INTO operating_expense_add_requests(idempotency_key,month,type,amount_sen,result) VALUES('legacy-key','2025-01','rental',1,'{"id":1,"merged":false,"alreadySaved":false}')`,
    ]);
    const receipt = await db.run("SELECT * FROM operating_expense_add_requests");
    await db.run("DELETE FROM operating_expenses WHERE id=1");
    await db.run(close("2025-01"));
    expect(await db.run("SELECT * FROM operating_expense_add_requests WHERE idempotency_key='legacy-key'")).toEqual(receipt);
    expect(await db.run("SELECT * FROM operating_expenses")).toEqual([]);
    await expect(db.run("INSERT INTO operating_expenses(month,type,amount_sen) VALUES('2025-01','rental',1)")).rejects.toThrow("BOKLI_MONTH_LOCKED");
    expect(await db.run("SELECT * FROM month_close_events")).toEqual([]);
  });

  it("rebuilds migrated parent/child tables preserving exact high-water marks, metadata, audit, receipts and guards", async () => {
    const db = getDb();
    await db.expand();
    // SQL integer literals and text reads avoid JavaScript's unsafe-number path.
    await db.run("INSERT INTO daily_sheets(id,date) VALUES(1,'2025-01-01'),(9007199254740993,'2025-02-01')");
    await db.run("DELETE FROM daily_sheets WHERE id=9007199254740993");
    await db.run("INSERT INTO cost_lines(id,daily_sheet_id,amount_sen,category) VALUES(1,1,1,'gas'),(9223372036854775806,1,2,'gas')");
    await db.run("DELETE FROM cost_lines WHERE id=9223372036854775806");
    await db.run(close("2025-01"));
    await db.run("INSERT INTO month_close_events(month,action,at,snapshot) VALUES('2025-01','close','historic','historical snapshot')");
    await db.run("INSERT INTO operating_expense_add_requests(idempotency_key,month,type,amount_sen,result) VALUES('retained','2025-01','rental',1,'historical result')");
    const meta = String((await db.run("SELECT name FROM sqlite_master WHERE name IN ('__drizzle_migrations','d1_migrations')"))[0].name);
    const metadata = await db.run(`SELECT * FROM ${meta} ORDER BY id`);
    const audit = await db.run("SELECT * FROM month_close_events");
    const receipts = await db.run("SELECT * FROM operating_expense_add_requests");
    const parents = await db.run("SELECT * FROM daily_sheets");
    const children = await db.run("SELECT * FROM cost_lines");
    const schema = await db.run("SELECT name,sql FROM sqlite_master WHERE name IN ('daily_sheets','cost_lines') ORDER BY name");
    const allObjects = await db.run("SELECT type,name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name");
    const objects = await db.run("SELECT type,name,sql FROM sqlite_master WHERE tbl_name IN ('daily_sheets','cost_lines') AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name");
    const sequences = await db.run("SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence WHERE name IN ('daily_sheets','cost_lines') ORDER BY name");
    expect(sequences).toEqual([{ name: "cost_lines", seq: "9223372036854775806" }, { name: "daily_sheets", seq: "9007199254740993" }]);
    const parentSql = String(schema.find(row => row.name === "daily_sheets")!.sql);
    const childSql = String(schema.find(row => row.name === "cost_lines")!.sql);
    // One offline test-owned atomic batch, FK remains ON. Remove child before
    // parent; install locks only after rows/sequences, as later converters must.
    await db.batch([
      ...objects.filter(row => row.type === "trigger").map(row => `DROP TRIGGER ${row.name}`),
      parentSql.replaceAll('"daily_sheets"', '"rebuild_sheets"').replaceAll('`daily_sheets`', '`rebuild_sheets`'),
      childSql.replaceAll('"cost_lines"', '"rebuild_lines"').replaceAll('`cost_lines`', '`rebuild_lines`').replaceAll('"daily_sheets"', '"rebuild_sheets"').replaceAll('`daily_sheets`', '`rebuild_sheets`'),
      "INSERT INTO rebuild_sheets SELECT * FROM daily_sheets",
      "INSERT INTO rebuild_lines SELECT * FROM cost_lines",
      "DROP TABLE cost_lines", "DROP TABLE daily_sheets",
      "ALTER TABLE rebuild_sheets RENAME TO daily_sheets", "ALTER TABLE rebuild_lines RENAME TO cost_lines",
      ...sequences.map(row => `UPDATE sqlite_sequence SET seq=${row.seq} WHERE name='${row.name}'`),
      ...objects.map(row => String(row.sql)),
    ]);
    expect(await db.run("SELECT * FROM daily_sheets")).toEqual(parents);
    expect(await db.run("SELECT * FROM cost_lines")).toEqual(children);
    expect(await db.run("SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence WHERE name IN ('daily_sheets','cost_lines') ORDER BY name")).toEqual(sequences);
    expect(await db.run(`SELECT * FROM ${meta} ORDER BY id`)).toEqual(metadata);
    expect(await db.run("SELECT * FROM month_close_events")).toEqual(audit);
    expect(await db.run("SELECT * FROM operating_expense_add_requests")).toEqual(receipts);
    expect(await db.run("SELECT type,name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name")).toEqual(allObjects);
    await expect(db.run("UPDATE daily_sheets SET cash_sen=1 WHERE id=1")).rejects.toThrow("BOKLI_MONTH_LOCKED");
    await expect(db.run("DELETE FROM cost_lines WHERE id=1")).rejects.toThrow("BOKLI_MONTH_LOCKED");
    await db.run("INSERT INTO daily_sheets(date) VALUES('2025-03-01')");
    expect(await db.run("SELECT CAST(id AS TEXT) AS id FROM daily_sheets WHERE date='2025-03-01'")).toEqual([{ id: "9007199254740994" }]);
    expect(await db.run("PRAGMA foreign_key_check")).toEqual([]);
    await db.expand();
    await expect(db.run("DELETE FROM daily_sheets WHERE id=1")).rejects.toThrow("BOKLI_MONTH_LOCKED");
  }, 30000);

}
