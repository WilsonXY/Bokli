import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
it("keeps alternate deployment URLs disabled and routes every API ahead of assets",()=>{
  const config=JSON.parse(fs.readFileSync("workers/wrangler.json","utf8"));
  expect(config.workers_dev).toBe(false);expect(config.preview_urls).toBe(false);
  expect(config.routes).toEqual([]);
  expect(config.assets).toEqual({directory:"../out",run_worker_first:["/api/*"],not_found_handling:"none"});
  expect(config.vars).toBeUndefined();expect(config.d1_databases).toBeUndefined();
  expect(config.triggers).toBeUndefined();expect(config.account_id).toBeUndefined();
  expect(fs.readFileSync("workers/wrangler.json","utf8")).not.toMatch(/@|secret|token|password/i);
});
it("bundles the real Worker without laptop runtime, fake identities or test hooks",async()=>{
  const result=await build({entryPoints:["workers/index.ts"],bundle:true,write:false,format:"esm",platform:"browser",target:"es2022",metafile:true});
  const inputs=Object.keys(result.metafile.inputs);
  expect(inputs).toContain("workers/auth.ts");expect(inputs).toContain("workers/reads.ts");
  expect(inputs).toContain("workers/writes.ts");
  for(const input of inputs) expect(input).not.toMatch(/api-tests|d1-tests|test-loopback|\.test\.|src\/db\/index|src\/auth|better-sqlite3|next-auth|node:/);
  expect(result.outputFiles[0].text).not.toMatch(/synthetic-key|synthetic-audience|mom@example|X-Test-User|FAKE_IDENTITY|faultHook|cloudflare:test|TEST_MIGRATIONS/);
  const declarations=await build({entryPoints:["src/lib/cloud-contract.ts"],bundle:true,write:false,format:"esm",platform:"browser",target:"es2022",metafile:true});
  expect(Object.keys(declarations.metafile.inputs)).toEqual(["src/lib/cloud-contract.ts"]);
  expect(declarations.outputFiles[0].text).toContain("/api/cloud-v1");
  const transport=await build({entryPoints:["src/lib/cloud-write.ts"],bundle:true,write:false,format:"esm",platform:"browser",target:"es2022",metafile:true});
  expect(Object.keys(transport.metafile.inputs)).toEqual(["src/lib/cloud-contract.ts","src/lib/cloud-write.ts"]);
  expect(transport.outputFiles[0].text).not.toMatch(/\/api\/(?!cloud-v1)|cloudflare:test|stage4_missing_test_table|test-loopback/);
  expect(path.resolve("workers",JSON.parse(fs.readFileSync("workers/wrangler.json","utf8")).main)).toBe(path.resolve("workers/index.ts"));
});
