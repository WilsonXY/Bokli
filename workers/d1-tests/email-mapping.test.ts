import { applyD1Migrations, env } from "cloudflare:test";
import { emailMappingCases } from "../../src/db/email-mapping-cases";
import type { SqlValue } from "../../src/db/month-lock-cases";
emailMappingCases(()=>({
  async run(sql,...values){return (await env.BOKLI_TEST_DB.prepare(sql).bind(...values).all<Record<string,SqlValue>>()).results;},
  async batch(statements){await env.BOKLI_TEST_DB.batch(statements.map(s=>env.BOKLI_TEST_DB.prepare(s)));},
  async baseline(){await applyD1Migrations(env.BOKLI_TEST_DB,env.TEST_MIGRATIONS.slice(0,10));},
  async expand(){await applyD1Migrations(env.BOKLI_TEST_DB,env.TEST_MIGRATIONS);},
}));
