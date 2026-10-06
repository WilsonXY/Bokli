import { describe, expect, it } from "vitest";
import { apiErrorPayloadFrom } from "./i18n";

describe("apiErrorPayloadFrom", () => {
  it("keeps message and code of an Error thrown with a code", () => {
    const err = Object.assign(new Error("Month is closed"), { code: "monthClosed" });
    expect(apiErrorPayloadFrom(err)).toEqual({ error: "Month is closed", code: "monthClosed" });
  });

  it("has no code for a plain Error (e.g. fetch network TypeError)", () => {
    expect(apiErrorPayloadFrom(new TypeError("Failed to fetch"))).toEqual({
      error: "Failed to fetch",
      code: undefined,
    });
  });
});
