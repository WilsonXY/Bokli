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

  it("rejects control-character bypasses (stripped by the URL parser)", () => {
    expect(sanitizeCallbackUrl("/\t//evil.com")).toBe("/");
    expect(sanitizeCallbackUrl("/\n//evil.com")).toBe("/");
    expect(sanitizeCallbackUrl("/\r/evil.example")).toBe("/");
    expect(sanitizeCallbackUrl("/\v//evil.com")).toBe("/");
    expect(sanitizeCallbackUrl("/\f//evil.com")).toBe("/");
    expect(sanitizeCallbackUrl("/\u0000//evil.com")).toBe("/");
    expect(sanitizeCallbackUrl("/\u007f//evil.com")).toBe("/");
    expect(sanitizeCallbackUrl("/expenses\t\t/../..//evil.com")).toBe("/");
  });

  it("keeps control-char targets same-origin once sanitized", () => {
    const base = "https://bokli.example";
    for (const raw of ["/\t//evil.example", "/\n//evil.com", "/\r/evil.example"]) {
      expect(new URL(sanitizeCallbackUrl(raw), base).origin).toBe(base);
    }
  });

  it("still allows normal same-origin paths", () => {
    expect(sanitizeCallbackUrl("/")).toBe("/");
    expect(sanitizeCallbackUrl("/expenses")).toBe("/expenses");
    expect(sanitizeCallbackUrl("/close")).toBe("/close");
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
