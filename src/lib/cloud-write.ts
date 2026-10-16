import { CLOUD_API_PREFIX, type CloudOperation, type CloudOperationStatus } from "./cloud-contract";

export class CloudOutcomeUnknownError extends Error {
  constructor(readonly operationId: string | null) { super("Write outcome unknown; retain the draft and operation ID for authenticated status resolution"); }
}
export const cloudOperations: Record<string,CloudOperation> = {
  "POST sheets":"sheet.save", "DELETE sheets":"sheet.delete", "POST expenses":"expense.add", "DELETE expenses":"expense.delete",
  "POST close":"month.close", "POST close/reopen":"month.reopen",
};
/** Caller persists draft/key/mapped actor. One status resolution and at most one same-key retry. */
export async function sendCloudWrite(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const operation = cloudOperations[`${request.method} ${url.pathname.slice(CLOUD_API_PREFIX.length+1)}`];
  if (!url.pathname.startsWith(CLOUD_API_PREFIX+"/") || !operation) throw new Error("Unsupported cloud mutation; laptop fallback is forbidden");
  const key = request.headers.get("Idempotency-Key");
  const actor = request.headers.get("X-Bokli-Actor-Id");
  if (key && (!actor || !Number.isSafeInteger(Number(actor)) || Number(actor)<1 || String(Number(actor))!==actor))
    throw new Error("Persist the mapped actor ID with the durable operation before sending");
  const headers = new Headers(request.headers);
  headers.set("X-Bokli-Api-Generation","cloud-v1");
  const durable = new Request(request,{headers,credentials:"same-origin",mode:"same-origin",cache:"no-store"});
  async function complete(reply: Response): Promise<Response> {
    if (reply.status>=200 && reply.status<300) {
      const body = await reply.json();
      if (!body || typeof body!=="object" || Array.isArray(body)) throw new Error("Incomplete cloud result");
      return new Response(JSON.stringify(body),{status:reply.status,headers:reply.headers});
    }
    return reply;
  }
  let response: Response | undefined;
  try { response = await complete(await fetch(durable.clone())); } catch { /* Headers or body can be lost after commit. */ }
  if (response && response.status<500) return response;
  if (!key) throw new CloudOutcomeUnknownError(null);
  const statusUrl = new URL(CLOUD_API_PREFIX+"/operations/status",url.origin);
  statusUrl.searchParams.set("operation",operation);statusUrl.searchParams.set("operationId",key);
  let status: CloudOperationStatus;
  try {
    const reply = await fetch(new Request(statusUrl,{headers:{"X-Bokli-Actor-Id":actor!},credentials:"same-origin",mode:"same-origin",cache:"no-store"}));
    if (!reply.ok) throw new Error();
    status = await reply.json();
    if (status.saved !== true && status.saved !== false) throw new Error();
    if (status.saved && (![200,201].includes(status.status) || !status.result || typeof status.result!=="object")) throw new Error();
  } catch { throw new CloudOutcomeUnknownError(key); }
  if (status.saved) return Response.json(status.result,{status:status.status});
  try {
    const retry = await complete(await fetch(durable.clone()));
    if (retry.status<500) return retry;
  } catch { /* The bounded retry can also commit and lose its reply. */ }
  throw new CloudOutcomeUnknownError(key);
}
