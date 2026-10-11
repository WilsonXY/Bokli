import { resolve } from "node:path";
/** Test-only startup guard. No account, external config, remote binding or persistence option. */
export function assertLocalWorkerTestConfig(options: unknown): void {
  const w=options as Record<string,unknown>|undefined;
  const mf=w?.miniflare as Record<string,unknown>|undefined;
  const b=mf?.bindings as Record<string,unknown>|undefined;
  if (!w||!mf||!b||w.main!==resolve("workers/index.ts")||w.singleWorker!==true||w.isolatedStorage!==true||w.remoteBindings!==false||
    Object.keys(w).some(k=>!["main","singleWorker","isolatedStorage","remoteBindings","miniflare"].includes(k))||
    Object.keys(mf).some(k=>!["compatibilityDate","d1Databases","bindings"].includes(k))||mf.compatibilityDate!=="2026-03-10"||
    JSON.stringify(mf.d1Databases)!=='["BOKLI_DB"]'||
    Object.keys(b).sort().join(",")!==["TEST_MIGRATIONS","TEST_READ_CASES","ACCESS_ISSUER","ACCESS_AUD","ACCESS_ALLOWED_EMAILS","ACCESS_HEALTH_SERVICE_ID","APP_VERSION"].sort().join(",")||
    !Array.isArray(b.TEST_MIGRATIONS)||typeof b.TEST_READ_CASES!=="string"||
    b.ACCESS_ISSUER!=="https://bokli-synthetic.cloudflareaccess.com"||b.ACCESS_AUD!=="synthetic-audience"||
    b.ACCESS_ALLOWED_EMAILS!=="mom@example.invalid,admin@example.invalid"||b.ACCESS_HEALTH_SERVICE_ID!=="synthetic-monitor.access"||b.APP_VERSION!=="stage3-synthetic") {
    throw new Error("Worker tests require isolated synthetic local D1 and fixed test bindings; remote/config/persistence overrides are forbidden");
  }
}
