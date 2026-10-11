import { ApiError, validateConfig, verifyAccess, lookupIdentity, type WorkerEnv } from "./auth";
import { createD1Adapter } from "./d1";
import { readDailySheet, readMonthPage, readHistory } from "./reads";
import { MoneyRangeError } from "../src/lib/money";
import { CLOUD_API_PREFIX } from "../src/lib/cloud-contract";
import { DrizzleQueryError } from "drizzle-orm";
import { mutate, status, WriteError, writeGuardError, type Operation } from "./writes";
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
      if (url.pathname !== `${CLOUD_API_PREFIX}/${page}` || !["identity","sheets","dashboard","expenses","close","history","close/reopen","operations/status"].includes(page)) throw new ApiError(404,"notFound");
      const expectedActor = request.headers.get("X-Bokli-Actor-Id");
      if (expectedActor !== null && expectedActor !== String(identity.id)) throw new ApiError(403,"identityChanged");
      if (request.method !== "GET") {
        if (!((request.method === "POST" && ["sheets","expenses","close","close/reopen"].includes(page)) || (request.method === "DELETE" && ["sheets","expenses"].includes(page)))) throw new ApiError(405,"mutationNotSupported");
        const response = await mutate(request,env,identity,claims.email,page);
        return json(response.body,response.status);
      }
      if (page === "close/reopen") throw new ApiError(405,"mutationNotSupported");
      if (page === "operations/status" || (page === "expenses" && url.searchParams.has("idempotencyKey"))) {
        const expense = page === "expenses";
        if ([...url.searchParams.keys()].some(k=>! (expense ? ["idempotencyKey"] : ["operation","operationId"]).includes(k)) || [...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1)) throw new ApiError(400,"invalidQuery");
        const operation = expense ? "expense.add" : url.searchParams.get("operation");
        if (!["sheet.save","sheet.delete","expense.add","expense.delete","month.close","month.reopen"].includes(operation??"")) throw new ApiError(400,"invalidQuery");
        return json(await status(env,identity,operation as Operation,url.searchParams.get(expense?"idempotencyKey":"operationId")??""));
      }
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
      const cause = error instanceof DrizzleQueryError ? error.cause : error;
      const integerOverflow = cause instanceof Error && /^D1_ERROR: integer overflow(?:: SQLITE_ERROR)?$/.test(cause.message);
      const guard = writeGuardError(error);
      if (guard) return json({error:guard.error,code:guard.code},guard.status);
      if (error instanceof WriteError) return json({error:error.error,code:error.code},error.status);
      if (error instanceof MoneyRangeError || integerOverflow) return json({code:"moneyRange"},422);
      return json({code:error instanceof ApiError ? error.code : request.method === "GET" ? "readUnavailable" : "outcomeUnknown"},error instanceof ApiError ? error.status : 503);
    }
  },
};

export default worker;
