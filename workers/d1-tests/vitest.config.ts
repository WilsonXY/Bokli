import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import { resolve } from "node:path";
import { assertLocalD1TestConfig } from "./safety";

export default defineWorkersConfig(async () => {
  // No Wrangler config/account. The pool owns ephemeral, per-test storage.
  const workers = {
    singleWorker: true,
    isolatedStorage: true,
    remoteBindings: false,
    miniflare: {
      compatibilityDate: "2026-03-10",
      d1Databases: ["BOKLI_TEST_DB"],
      bindings: { TEST_MIGRATIONS: await readD1Migrations(resolve("drizzle")) },
    },
  };
  assertLocalD1TestConfig(workers);
  return {
    test: {
      include: ["workers/d1-tests/**/*.test.ts"],
      poolOptions: { workers },
    },
  };
});
