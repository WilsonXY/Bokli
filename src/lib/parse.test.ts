import { describe, expect, it } from "vitest";
import {
  checkBodySize,
  MAX_BODY_JSON_BYTES,
  parseJsonBody,
  parsePositiveId,
} from "./parse";

function jsonReq(body: string | undefined, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/x", { method: "POST", body, headers });
}

describe("parseJsonBody", () => {
  it("returns a JSON object body as-is", async () => {
    expect(await parseJsonBody(jsonReq('{"month":"2026-03"}'))).toEqual({
      ok: true,
      body: { month: "2026-03" },
    });
  });

  it("treats a literal null body as an empty object", async () => {
    expect(await parseJsonBody(jsonReq("null"))).toEqual({ ok: true, body: {} });
  });

  it("rejects non-object JSON bodies", async () => {
    for (const raw of ["[]", "[1,2]", '"null"', '"text"', "42", "true"]) {
      expect(await parseJsonBody(jsonReq(raw))).toEqual({
        ok: false,
        status: 400,
        error: "Request body must be a JSON object",
        code: "saveError",
      });
    }
  });

  it("rejects unparseable and empty bodies with the SyntaxError message", async () => {
    for (const raw of ["{not json", "", undefined]) {
      expect(await parseJsonBody(jsonReq(raw))).toEqual({
        ok: false,
        status: 400,
        error: "Invalid JSON in request body",
        code: "saveError",
      });
    }
  });

  it("rejects an oversize body even without a Content-Length header", async () => {
    const big = JSON.stringify({ note: "x".repeat(MAX_BODY_JSON_BYTES) });
    const result = await parseJsonBody(jsonReq(big));
    expect(result).toMatchObject({ ok: false, status: 413, code: "saveError" });
  });

  it("accepts a body right at the cap", async () => {
    const pad = MAX_BODY_JSON_BYTES - JSON.stringify({ n: "" }).length;
    const exact = JSON.stringify({ n: "x".repeat(pad) });
    expect(exact.length).toBe(MAX_BODY_JSON_BYTES);
    expect((await parseJsonBody(jsonReq(exact))).ok).toBe(true);
  });
});

describe("checkBodySize", () => {
  it("passes when Content-Length is absent, at, or under the cap", () => {
    expect(checkBodySize(jsonReq(undefined))).toEqual({ ok: true });
    expect(
      checkBodySize(jsonReq(undefined, { "content-length": String(MAX_BODY_JSON_BYTES) })),
    ).toEqual({ ok: true });
  });

  it("rejects a declared Content-Length over the cap with 413", () => {
    const result = checkBodySize(
      jsonReq(undefined, { "content-length": String(MAX_BODY_JSON_BYTES + 1) }),
    );
    expect(result).toMatchObject({ ok: false, status: 413, code: "saveError" });
  });
});

describe("parsePositiveId", () => {
  it("accepts positive integers as numbers or digit strings", () => {
    expect(parsePositiveId(7, "'id'")).toEqual({ ok: true, id: 7 });
    expect(parsePositiveId("42", "'id'")).toEqual({ ok: true, id: 42 });
  });

  it("rejects zero, negatives, floats, junk, and non-numeric types", () => {
    for (const value of [0, -1, 1.5, "0", "-1", "1.5", "2junk", " 3", "1e2", "", NaN, Infinity, true, null, undefined, {}]) {
      expect(parsePositiveId(value, "'id'")).toEqual({
        ok: false,
        error: "Valid 'id' is required",
        code: "saveError",
      });
    }
  });

  it("rejects ids beyond the safe-integer range", () => {
    expect(parsePositiveId("9007199254740993", "'id'").ok).toBe(false);
  });
});
