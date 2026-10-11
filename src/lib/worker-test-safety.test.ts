import { expect, it } from "vitest";
import { resolve } from "node:path";
import { assertLocalWorkerTestConfig } from "../../workers/api-tests/safety";
const local={main:resolve("workers/index.ts"),singleWorker:true,isolatedStorage:true,remoteBindings:false,miniflare:{compatibilityDate:"2026-03-10",d1Databases:["BOKLI_DB"],bindings:{TEST_MIGRATIONS:[],TEST_READ_CASES:"[]",ACCESS_ISSUER:"https://bokli-synthetic.cloudflareaccess.com",ACCESS_AUD:"synthetic-audience",ACCESS_ALLOWED_EMAILS:"mom@example.invalid,admin@example.invalid",ACCESS_HEALTH_SERVICE_ID:"synthetic-monitor.access",APP_VERSION:"stage3-synthetic"}}};
it("refuses Worker test remote/config/persistence/identity overrides before runtime startup",()=>{
  expect(()=>assertLocalWorkerTestConfig(local)).not.toThrow();
  for(const patch of [{remoteBindings:true},{isolatedStorage:false},{wrangler:{configPath:"workers/wrangler.json"}},{main:resolve("other.ts")},{miniflare:{...local.miniflare,d1Persist:"data-dev/"}},{miniflare:{...local.miniflare,d1Databases:["shared"]}},{miniflare:{...local.miniflare,workers:[]}},{miniflare:{...local.miniflare,bindings:{...local.miniflare.bindings,ACCESS_ISSUER:"https://other.cloudflareaccess.com"}}},{miniflare:{...local.miniflare,bindings:{...local.miniflare.bindings,FAKE_IDENTITY:"Admin"}}}])
    expect(()=>assertLocalWorkerTestConfig({...local,...patch})).toThrow("Worker tests require");
});
