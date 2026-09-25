import fs from "node:fs";
import path from "node:path";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { costLines, operatingExpenses } from "@/db/schema";
import { COST_CATEGORIES, OPERATING_EXPENSE_TYPES } from "./vocab";

const dialect = new SQLiteSyncDialect();

function checkSql(table: typeof costLines | typeof operatingExpenses, name: string): string {
  const check = getTableConfig(table).checks.find((c) => c.name === name);
  if (!check) throw new Error(`CHECK ${name} not found`);
  return dialect.sqlToQuery(check.value).sql;
}

function inList(values: readonly string[]): string {
  return `IN (${values.map((v) => `'${v}'`).join(",")})`;
}

const migrationsDir = path.resolve(__dirname, "../../drizzle");
const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/**
 * IN-list of the most recent migration that (re)defines the named CHECK.
 * Older migrations may legitimately hold superseded lists (e.g. 0000 predates
 * 'maintenance'); only the latest definition is what the DB enforces.
 */
function latestMigrationInList(name: string): string {
  const re = new RegExp(`CONSTRAINT "${name}" CHECK\\([^)]*?(IN \\([^)]*\\))\\)`, "g");
  let latest: string | undefined;
  for (const f of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), "utf8");
    for (const m of sql.matchAll(re)) latest = m[1];
  }
  if (!latest) throw new Error(`No migration defines CHECK ${name}`);
  return latest.replace(/,\s+/g, ",");
}

describe("vocab stays in sync with schema CHECK constraints", () => {
  it("chk_cost_lines_category matches COST_CATEGORIES", () => {
    expect(checkSql(costLines, "chk_cost_lines_category")).toBe(
      `"cost_lines"."category" ${inList(COST_CATEGORIES)}`,
    );
    expect(latestMigrationInList("chk_cost_lines_category")).toBe(inList(COST_CATEGORIES));
  });

  it("chk_opex_type matches OPERATING_EXPENSE_TYPES", () => {
    expect(checkSql(operatingExpenses, "chk_opex_type")).toBe(
      `"operating_expenses"."type" ${inList(OPERATING_EXPENSE_TYPES)}`,
    );
    expect(latestMigrationInList("chk_opex_type")).toBe(inList(OPERATING_EXPENSE_TYPES));
  });
});
