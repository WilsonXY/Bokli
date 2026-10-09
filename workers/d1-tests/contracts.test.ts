import { applyD1Migrations, env } from "cloudflare:test";
import { schemaContractCases, type ContractDb } from "../../src/db/contract-cases";
import baseline from "../../drizzle/bootstrap-baseline.json";
import { expect } from "vitest";

const db: ContractDb = {
  async run(sql, ...values) {
    const result = await env.BOKLI_TEST_DB.prepare(sql).bind(...values).all<Record<string, string | number | null>>();
    return result.results;
  },
  async batch(statements) { await env.BOKLI_TEST_DB.batch(statements.map(sql => env.BOKLI_TEST_DB.prepare(sql))); },
  async baseline() {
    expect((await env.BOKLI_TEST_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_cf_METADATA'").all()).results).toEqual([]);
    expect(env.TEST_MIGRATIONS.slice(0, baseline.migrations.length).map(m => m.name)).toEqual(baseline.migrations.map(m => `${m.tag}.sql`));
    await applyD1Migrations(env.BOKLI_TEST_DB, env.TEST_MIGRATIONS.slice(0, baseline.migrations.length));
  },
  async expand() { await applyD1Migrations(env.BOKLI_TEST_DB, env.TEST_MIGRATIONS.slice(baseline.migrations.length)); },
};
schemaContractCases(() => db);
