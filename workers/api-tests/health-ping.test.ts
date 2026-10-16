import { env, fetchMock, createScheduledController, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, it } from "vitest";
// Each expected ping is an interceptor; afterEach fails if it was not called.
import worker from "../index";

const ping = "https://hc-ping.invalid";
beforeEach(()=>{fetchMock.activate();fetchMock.disableNetConnect();});
afterEach(()=>{fetchMock.assertNoPendingInterceptors();fetchMock.deactivate();});
async function run(extra: Record<string,unknown>) {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({cron:"*/5 * * * *"}),{...env,...extra} as never,ctx);
  await waitOnExecutionContext(ctx);
}
it("pings the health check after the database answers",async()=>{
  fetchMock.get(ping).intercept({method:"GET",path:"/check-id"}).reply(200,"OK");
  await run({HEALTHCHECK_URL:`${ping}/check-id`});
});
it("reports a failure when the database does not answer",async()=>{
  fetchMock.get(ping).intercept({method:"GET",path:"/check-id/fail"}).reply(200,"OK");
  await run({HEALTHCHECK_URL:`${ping}/check-id`,BOKLI_DB:{prepare:()=>{throw new Error("down");}}});
});
it("does nothing without a configured health check (staging, tests)",async()=>{
  await run({HEALTHCHECK_URL:undefined});
});
