import { sequenceInteger, type DatabaseImage } from "./conversion-contracts";
import type { ContractDb } from "./contract-cases";

/** Synthetic test helper only, never used by app or deployment code. */
export async function captureFixture(db: ContractDb): Promise<DatabaseImage> {
  const definitions = await db.run("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_cf_METADATA' ORDER BY name");
  const tables = [];
  for (const definition of definitions) {
    const name = String(definition.name);
    const columns = (await db.run(`PRAGMA table_info("${name}")`)).map(row => String(row.name));
    tables.push({ name, sql: String(definition.sql), columns, rows: await db.run(`SELECT * FROM "${name}" ORDER BY rowid`) });
  }
  const objects = await db.run("SELECT type,name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name");
  const sequences = await db.run("SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name");
  return { tables, objects: objects as DatabaseImage["objects"], sequences: sequences as DatabaseImage["sequences"] };
}
const fkOrder = ["users", "daily_sheets", "cost_lines", "operating_expenses", "month_closes", "month_close_events", "login_attempts", "operating_expense_add_requests", "user_email_identities", "mutation_receipts", "database_state"];
function quote(value: string | number | null): string {
  return value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
}
/** Test-owned images only. Tables first, FK-ordered rows, sequences, objects last. */
export function fixtureRestoreStatements(image: DatabaseImage): string[] {
  const ordered = [...image.tables].sort((a, b) => fkOrder.indexOf(a.name) - fkOrder.indexOf(b.name));
  return [
    ...image.tables.map(table => table.sql),
    ...ordered.flatMap(table => table.rows.map(row => `INSERT INTO "${table.name}"(${table.columns.map(c => `"${c}"`).join(",")}) VALUES(${table.columns.map(c => quote(row[c])).join(",")})`)),
    "DELETE FROM sqlite_sequence",
    ...image.sequences.map(row => `INSERT INTO sqlite_sequence(name,seq) VALUES(${quote(row.name)},${sequenceInteger(row.seq)})`),
    ...image.objects.map(object => object.sql),
  ];
}

export function fixtureDropStatements(image: DatabaseImage): string[] {
  return [
    ...image.objects.filter(o => o.type === "trigger").map(o => `DROP TRIGGER "${o.name}"`),
    ...[...image.tables].sort((a, b) => fkOrder.indexOf(b.name) - fkOrder.indexOf(a.name)).map(t => `DROP TABLE "${t.name}"`),
  ];
}
