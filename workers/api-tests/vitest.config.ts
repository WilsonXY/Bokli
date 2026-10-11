import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import { assertLocalWorkerTestConfig } from "./safety";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { stabilizeTestLoopback } from "../test-loopback";
stabilizeTestLoopback();
export default defineWorkersConfig(async () => {
 const workers = {
      main: resolve("workers/index.ts"),
      singleWorker: true,
      isolatedStorage: true,
      remoteBindings: false,
      miniflare: {
        compatibilityDate: "2026-03-10",
        d1Databases: ["BOKLI_DB","BOKLI_RECOVERY_DB"],
        bindings: {
          TEST_READ_CASES: execFileSync(process.execPath,["--import","tsx","workers/api-tests/legacy-reference.ts"],{encoding:"utf8"}),
          TEST_MIGRATIONS: await readD1Migrations(resolve("drizzle")),
          ACCESS_ISSUER: "https://bokli-synthetic.cloudflareaccess.com",
          ACCESS_AUD: "synthetic-audience",
          ACCESS_ALLOWED_EMAILS: "mom@example.invalid,admin@example.invalid",
          ACCESS_HEALTH_SERVICE_ID: "synthetic-monitor.access",
          APP_VERSION: "stage3-synthetic",
        },
      },
    };
 assertLocalWorkerTestConfig(workers);
 return {resolve:{alias:{"@":resolve("src")}},test:{include:["workers/api-tests/**/*.test.ts"],poolOptions:{workers}}};
});
