import { applyD1Migrations, env } from "cloudflare:test";
import { monthLockCases, type LockDb, type SqlValue } from "../../src/db/month-lock-cases";

const db: LockDb = {
  async run(sql, ...values) {
    return (await env.BOKLI_TEST_DB.prepare(sql).bind(...values).all<Record<string, SqlValue>>()).results;
  },
  async batch(statements) { await env.BOKLI_TEST_DB.batch(statements.map(sql => env.BOKLI_TEST_DB.prepare(sql))); },
  async baseline() { await applyD1Migrations(env.BOKLI_TEST_DB, env.TEST_MIGRATIONS.slice(0, 9)); },
  async expand() { await applyD1Migrations(env.BOKLI_TEST_DB, env.TEST_MIGRATIONS); },
};
monthLockCases(() => db);
