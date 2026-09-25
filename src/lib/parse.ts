/**
 * Request-parsing helpers shared by the API routes.
 *
 * Each helper returns a result object instead of throwing, so a route can turn
 * a failure straight into a `{ error, code }` response. Error prose matches
 * what the routes returned before these helpers existed; codes stay inside the
 * existing `ApiErrorCode` vocabulary.
 */

/** Largest JSON request body the API accepts. Daily Sheets are the biggest payload and stay far below this. */
export const MAX_BODY_JSON_BYTES = 64 * 1024;

const BODY_TOO_LARGE = `Request body exceeds ${MAX_BODY_JSON_BYTES} bytes`;

export type ParseFailure = { ok: false; status: number; error: string; code: "saveError" };

/**
 * Rejects a request whose declared Content-Length is over MAX_BODY_JSON_BYTES
 * before any of the body is read. A missing or unparseable header passes here;
 * parseJsonBody re-checks the actual byte count.
 */
export function checkBodySize(req: Request): { ok: true } | ParseFailure {
  const header = req.headers.get("content-length");
  const length = header === null ? NaN : Number(header);
  if (Number.isFinite(length) && length > MAX_BODY_JSON_BYTES) {
    return { ok: false, status: 413, error: BODY_TOO_LARGE, code: "saveError" };
  }
  return { ok: true };
}

/**
 * Reads a JSON object body. A literal `null` body counts as an empty object;
 * arrays and other non-object JSON are rejected. Oversize bodies get 413,
 * unparseable ones the same 400 that handleError gives a SyntaxError.
 */
export async function parseJsonBody(
  req: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | ParseFailure> {
  const size = checkBodySize(req);
  if (!size.ok) return size;

  let bytes: ArrayBuffer;
  try {
    bytes = await req.arrayBuffer();
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON in request body", code: "saveError" };
  }
  if (bytes.byteLength > MAX_BODY_JSON_BYTES) {
    return { ok: false, status: 413, error: BODY_TOO_LARGE, code: "saveError" };
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON in request body", code: "saveError" };
  }

  if (value === null) {
    return { ok: true, body: {} };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      status: 400,
      error: "Request body must be a JSON object",
      code: "saveError",
    };
  }
  return { ok: true, body: value as Record<string, unknown> };
}

/**
 * Parses a positive integer id from a query-string value or a JSON field.
 * Numbers must be integers > 0; strings must be all digits (no "1.5", "2junk",
 * " 3", "1e2"). Anything else fails with "Valid <label> is required".
 */
export function parsePositiveId(
  value: unknown,
  label: string,
): { ok: true; id: number } | { ok: false; error: string; code: "saveError" } {
  let id = NaN;
  if (typeof value === "number") {
    id = value;
  } else if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    id = Number(value);
  }
  if (!Number.isSafeInteger(id) || id <= 0) {
    return { ok: false, error: `Valid ${label} is required`, code: "saveError" };
  }
  return { ok: true, id };
}
