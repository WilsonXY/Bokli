import { ApiError, validateConfig, verifyAccess, lookupIdentity, type WorkerEnv } from "./auth";
import { createD1Adapter } from "./d1";
import { readDailySheet, readMonthPage, readHistory } from "./reads";
import { MoneyRangeError } from "../src/lib/money";
import { CLOUD_API_PREFIX } from "../src/lib/cloud-contract";
import { DrizzleQueryError } from "drizzle-orm";
function json(value: unknown, status=200) {
  return Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    try {
      const allowedEmails = validateConfig(env);
      const claims = await verifyAccess(request,env);
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/health" && !url.search && !url.hash &&
        claims.common_name === env.ACCESS_HEALTH_SERVICE_ID && claims.sub === "" && claims.email === undefined) {
        await env.BOKLI_DB.prepare("SELECT 1").first();
        return json({status:"ok",version:env.APP_VERSION});
      }
      if (claims.common_name !== undefined || url.pathname === "/api/health") throw new ApiError(403,"forbidden");
      const identity = await lookupIdentity(claims,env,allowedEmails);
      const page = url.pathname.slice(CLOUD_API_PREFIX.length+1);
      if (url.pathname !== `${CLOUD_API_PREFIX}/${page}` || !["identity","sheets","dashboard","expenses","close","history","close/reopen"].includes(page)) throw new ApiError(404,"notFound");
      if (request.method !== "GET") throw new ApiError(405,"mutationNotSupported");
      if (page === "close/reopen") throw new ApiError(405,"mutationNotSupported");
      const parameter = page === "sheets"?"date":page === "identity"||page === "history"?undefined:"month";
      if ([...url.searchParams.keys()].some(key=>key!==parameter) || (parameter && (url.searchParams.getAll(parameter).length>1 || (url.searchParams.get(parameter)?.length??0)>10))) throw new ApiError(400,"invalidQuery");
      if (page === "identity") return json(identity);
      const db = createD1Adapter(env.BOKLI_DB);
      if (page === "sheets") return json(await readDailySheet(db,url.searchParams.get("date")??undefined));
      if (page === "dashboard" || page === "expenses" || page === "close") return json(await readMonthPage(db,page,identity,url.searchParams.get("month")??undefined));
      if (page === "history") return json(await readHistory(db));
      throw new ApiError(404,"notFound");
    } catch (error) {
      // The supported adapter preserves D1's integer-overflow error as the query cause.
      if (error instanceof MoneyRangeError || (error instanceof DrizzleQueryError && String(error.cause).includes("integer overflow"))) return json({code:"moneyRange"},422);
      return json({code:error instanceof ApiError ? error.code : "readUnavailable"},error instanceof ApiError ? error.status : 503);
    }
  },
};

export default worker;
