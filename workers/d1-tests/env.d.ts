/// <reference types="@cloudflare/vitest-pool-workers" />
import type { D1Migration } from "cloudflare:test";
import type { D1Database } from "@cloudflare/workers-types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    BOKLI_TEST_DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
  }
}
