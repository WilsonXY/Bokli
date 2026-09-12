import { describe, it, expect, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}));

import LoginPage from "../../app/login/page";
import { resolveLoginErrorMessage } from "@/lib/login-error";
import { DICTIONARY } from "@/lib/i18n";

const t = DICTIONARY.zh;

describe("LoginForm error surfacing and spoofing defense", () => {
  it("resolves RateLimited message on exact code match", () => {
    const msg = resolveLoginErrorMessage("RateLimited", "CredentialsSignin", t);
    expect(msg).toBe(t.loginRateLimited);
  });

  it("resolves RateLimited message on exact error match", () => {
    const msg = resolveLoginErrorMessage(null, "RateLimited", t);
    expect(msg).toBe(t.loginRateLimited);
  });

  it("resolves generic error for standard CredentialsSignin", () => {
    const msg = resolveLoginErrorMessage("credentials", "CredentialsSignin", t);
    expect(msg).toBe(t.loginError);
  });

  it("prevents spoofing via query parameters containing substring RateLimited", () => {
    // Attack payloads trying to abuse string.includes("RateLimited")
    const spoof1 = resolveLoginErrorMessage(null, "fake_RateLimited_error", t);
    expect(spoof1).toBe(t.loginError);
    expect(spoof1).not.toBe(t.loginRateLimited);

    const spoof2 = resolveLoginErrorMessage("NotRateLimited", "CredentialsSignin", t);
    expect(spoof2).toBe(t.loginError);
    expect(spoof2).not.toBe(t.loginRateLimited);
  });

  it("returns null when neither code nor error is present", () => {
    expect(resolveLoginErrorMessage(null, null, t)).toBeNull();
    expect(resolveLoginErrorMessage(undefined, undefined, t)).toBeNull();
  });

  it("renders the login page component cleanly without errors", () => {
    const html = ReactDOMServer.renderToStaticMarkup(React.createElement(LoginPage));
    expect(html).toContain(t.loginTitle);
    expect(html).toContain(t.username);
    expect(html).toContain(t.password);
  });
});
