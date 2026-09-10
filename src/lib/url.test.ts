import { describe, expect, it } from "vitest";
import { sanitizeCallbackUrl } from "./url";

describe("sanitizeCallbackUrl", () => {
  it("allows safe relative paths", () => {
    expect(sanitizeCallbackUrl("/")).toBe("/");
    expect(sanitizeCallbackUrl("/dashboard")).toBe("/dashboard");
    expect(sanitizeCallbackUrl("/dashboard?month=2026-03")).toBe("/dashboard?month=2026-03");
  });

  it("rejects absolute URLs with protocol", () => {
    expect(sanitizeCallbackUrl("https://evil.com")).toBe("/");
    expect(sanitizeCallbackUrl("http://evil.com")).toBe("/");
    expect(sanitizeCallbackUrl("javascript:alert(1)")).toBe("/");
  });

  it("rejects protocol-relative URLs starting with //", () => {
    expect(sanitizeCallbackUrl("//evil.com")).toBe("/");
    expect(sanitizeCallbackUrl("///evil.com")).toBe("/");
  });

  it("rejects backslash bypasses (e.g. /\\evil)", () => {
    expect(sanitizeCallbackUrl("/\\evil.com")).toBe("/");
    expect(sanitizeCallbackUrl("/dashboard\\evil")).toBe("/");
    expect(sanitizeCallbackUrl("\\evil.com")).toBe("/");
  });

  it("handles null, undefined, empty strings", () => {
    expect(sanitizeCallbackUrl(null)).toBe("/");
    expect(sanitizeCallbackUrl(undefined)).toBe("/");
    expect(sanitizeCallbackUrl("")).toBe("/");
  });

  it("supports custom fallback", () => {
    expect(sanitizeCallbackUrl("//evil.com", "/login")).toBe("/login");
    expect(sanitizeCallbackUrl("/dashboard", "/login")).toBe("/dashboard");
  });
});
