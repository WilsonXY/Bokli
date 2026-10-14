import worker from "./index";
import type { WorkerEnv } from "./auth";

/**
 * Local automated tests only, used by `scripts/cloud-local.mjs --test-identity`.
 * Answers the JWKS fetch for one synthetic issuer with a key the test script
 * generated, so it can sign its own Access JWTs. Not deployable: the deployed
 * entry is index.ts (workers/wrangler.json), and this refuses any other issuer.
 */
const LOCAL_TEST_ISSUER = "https://bokli-local-test.cloudflareaccess.com";
const realFetch = globalThis.fetch;

const localTestWorker = {
  fetch(request: Request, env: WorkerEnv & { LOCAL_TEST_JWKS: string }): Promise<Response> | Response {
    if (env.ACCESS_ISSUER !== LOCAL_TEST_ISSUER || !env.LOCAL_TEST_JWKS) return new Response("Local test identity only", { status: 503 });
    globalThis.fetch = (input, init) =>
      new Request(input).url === `${LOCAL_TEST_ISSUER}/cdn-cgi/access/certs`
        ? Promise.resolve(new Response(env.LOCAL_TEST_JWKS, { headers: { "content-type": "application/json" } }))
        : realFetch(input, init);
    return worker.fetch(request, env);
  },
};

export default localTestWorker;
