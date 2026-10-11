/// <reference types="@cloudflare/vitest-pool-workers" />
import type { D1Database } from "@cloudflare/workers-types";
declare module "cloudflare:test" {
  interface ProvidedEnv {
    BOKLI_DB: D1Database;
    TEST_READ_CASES: string;
    ACCESS_ISSUER: string;
    ACCESS_AUD: string;
    ACCESS_ALLOWED_EMAILS: string;
    ACCESS_HEALTH_SERVICE_ID: string;
    APP_VERSION: string;
  }
}
