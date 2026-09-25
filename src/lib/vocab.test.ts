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

const migrationsSql = fs
  .readdirSync(path.resolve(__dirname, "../../drizzle"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => fs.readFileSync(path.resolve(__dirname, "../../drizzle", f), "utf8"))
  .join("\n");

describe("vocab stays in sync with schema CHECK constraints", () => {
  it("chk_cost_lines_category matches COST_CATEGORIES", () => {
    expect(checkSql(costLines, "chk_cost_lines_category")).toBe(
      `"cost_lines"."category" ${inList(COST_CATEGORIES)}`,
    );
    expect(migrationsSql).toContain(`"category" ${inList(COST_CATEGORIES)}`);
  });

  it("chk_opex_type matches OPERATING_EXPENSE_TYPES", () => {
    expect(checkSql(operatingExpenses, "chk_opex_type")).toBe(
      `"operating_expenses"."type" ${inList(OPERATING_EXPENSE_TYPES)}`,
    );
    expect(migrationsSql).toContain(`"type" ${inList(OPERATING_EXPENSE_TYPES)}`);
  });
});
