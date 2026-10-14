import { CLOUD_API_PREFIX, type CloudReads } from "./cloud-contract";
import { CloudOutcomeUnknownError, cloudOperations, sendCloudWrite } from "./cloud-write";

async function getJson<T>(url: string, headers?: HeadersInit): Promise<T> {
  const res = await fetch(url, { headers, cache: "no-store", credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { code: data.code });
  return data;
}

let identity: Promise<CloudReads["identity"]> | null = null;
/** The signed-in mapped user, fetched once per page load. */
export function cloudIdentity(): Promise<CloudReads["identity"]> {
  identity ??= getJson<CloudReads["identity"]>(`${CLOUD_API_PREFIX}/identity`).catch((err) => {
    identity = null;
    throw err;
  });
  return identity;
}

export function cloudRead<K extends Exclude<keyof CloudReads, "identity">>(page: K, query = ""): Promise<CloudReads[K]> {
  return getJson(`${CLOUD_API_PREFIX}/${page}${query}`);
}

// The last unconfirmed attempt per operation, kept with its draft: sending the
// same draft again reuses the key, a changed draft gets a new one.
const pending = new Map<string, { request: string; key: string }>();
// Keys whose outcome is unknown: ask operations/status before sending again.
const unknown = new Set<string>();

const outcomeUnknown = () =>
  Response.json({ code: "outcomeUnknown", error: "Save outcome unknown" }, { status: 503 });

/**
 * The screens' one door to the API. Laptop: plain fetch to /api/*. Cloud: the
 * same call against /api/cloud-v1/* with the mapped actor and one
 * Idempotency-Key per save attempt (the caller's own key if it sends one).
 */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (process.env.BOKLI_TARGET !== "cloud") return fetch(url, init);
  const target = new URL(url.replace(/^\/api\//, `${CLOUD_API_PREFIX}/`), location.origin);
  const headers = new Headers(init.headers);
  headers.set("X-Bokli-Actor-Id", String((await cloudIdentity()).id));
  const method = init.method ?? "GET";
  if (method === "GET") return fetch(target, { ...init, headers, cache: "no-store" });

  const page = target.pathname.slice(CLOUD_API_PREFIX.length + 1);
  const operation = `${method} ${page}`;
  const request = `${target.search} ${init.body ?? ""}`;
  let key = headers.get("Idempotency-Key");
  if (!key) {
    const prior = pending.get(operation);
    key = prior?.request === request ? prior.key : crypto.randomUUID();
    pending.set(operation, { request, key });
    headers.set("Idempotency-Key", key);
  }

  if (unknown.has(key)) {
    const status = new URL(`${CLOUD_API_PREFIX}/operations/status`, location.origin);
    status.searchParams.set("operation", cloudOperations[operation]);
    status.searchParams.set("operationId", key);
    const answer = await getJson<{ saved: boolean; status?: number; result?: unknown }>(
      status.href, { "X-Bokli-Actor-Id": headers.get("X-Bokli-Actor-Id")! },
    ).catch(() => null);
    if (!answer) return outcomeUnknown();
    if (answer.saved) {
      settle(operation, key);
      return Response.json(answer.result, { status: answer.status });
    }
  }

  try {
    const res = await sendCloudWrite(new Request(target, { ...init, headers }));
    settle(operation, key);
    return res;
  } catch (err) {
    if (!(err instanceof CloudOutcomeUnknownError)) throw err;
    unknown.add(key);
    return outcomeUnknown();
  }
}

function settle(operation: string, key: string) {
  unknown.delete(key);
  if (pending.get(operation)?.key === key) pending.delete(operation);
}
