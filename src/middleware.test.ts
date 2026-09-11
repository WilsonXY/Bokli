import { describe, expect, it, vi } from "vitest";

// Pure-logic mock: extract the inner middleware handler from NextAuth(authConfig).auth(...)
vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    auth: vi.fn((handler: (req: any) => any) => handler),
  })),
}));

import middleware, { config } from "../middleware";

function createMockRequest(urlStr: string, session: any = null) {
  const url = new URL(urlStr);
  return {
    nextUrl: url,
    auth: session,
  };
}

describe("middleware logic", () => {
  describe("anonymous requests", () => {
    it("redirects anonymous /protected to /login with callbackUrl", async () => {
      const req = createMockRequest("http://localhost:3000/protected");
      const res = await (middleware as any)(req);

      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).toBe("http://localhost:3000/login?callbackUrl=%2Fprotected");
    });

    it("preserves query params in callbackUrl when redirecting to /login", async () => {
      const req = createMockRequest("http://localhost:3000/protected?from=report&id=123");
      const res = await (middleware as any)(req);

      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).toBe(
        "http://localhost:3000/login?callbackUrl=%2Fprotected%3Ffrom%3Dreport%26id%3D123"
      );
    });

    it("allows anonymous access to /login without redirect", async () => {
      const req = createMockRequest("http://localhost:3000/login");
      const res = await (middleware as any)(req);

      expect(res.status).toBe(200);
    });

    it("treats /login/ trailing slash same as /login (allows anonymous access)", async () => {
      const req = createMockRequest("http://localhost:3000/login/");
      const res = await (middleware as any)(req);

      expect(res.status).toBe(200);
    });

    it("rejects unauthorized API access with 401 JSON except for /api/auth/*", async () => {
      const authApiReq = createMockRequest("http://localhost:3000/api/auth/csrf");
      const authApiRes = await (middleware as any)(authApiReq);
      expect(authApiRes.status).toBe(200);

      const protectedApiReq = createMockRequest("http://localhost:3000/api/protected-data");
      const protectedApiRes = await (middleware as any)(protectedApiReq);
      expect(protectedApiRes.status).toBe(401);
      const body = await protectedApiRes.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });
  });

  describe("authenticated requests", () => {
    const mockSession = { user: { name: "mom", role: "Operator" } };

    it("redirects authed user hitting /login away to /dashboard", async () => {
      const req = createMockRequest("http://localhost:3000/login", mockSession);
      const res = await (middleware as any)(req);

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
    });

    it("treats /login/ trailing slash same as /login for authed user (redirects away)", async () => {
      const req = createMockRequest("http://localhost:3000/login/", mockSession);
      const res = await (middleware as any)(req);

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
    });

    it("redirects authed user hitting /login with valid callbackUrl to that callbackUrl", async () => {
      const req = createMockRequest("http://localhost:3000/login?callbackUrl=%2Fdashboard", mockSession);
      const res = await (middleware as any)(req);

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
    });

    it("redirects authed user hitting /login with query params in callbackUrl", async () => {
      const req = createMockRequest(
        "http://localhost:3000/login?callbackUrl=%2Fdashboard%3Fmonth%3D2026-03",
        mockSession,
      );
      const res = await (middleware as any)(req);

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard?month=2026-03");
    });

    it("redirects authed user hitting /login with unsafe or backslash callbackUrl to root /", async () => {
      const req1 = createMockRequest("http://localhost:3000/login?callbackUrl=https%3A%2F%2Fevil.com", mockSession);
      const res1 = await (middleware as any)(req1);
      expect(res1.headers.get("location")).toBe("http://localhost:3000/dashboard");

      const req2 = createMockRequest("http://localhost:3000/login?callbackUrl=%2F%2Fevil.com", mockSession);
      const res2 = await (middleware as any)(req2);
      expect(res2.headers.get("location")).toBe("http://localhost:3000/dashboard");

      const req3 = createMockRequest("http://localhost:3000/login?callbackUrl=%2F%5Cevil.com", mockSession);
      const res3 = await (middleware as any)(req3);
      expect(res3.headers.get("location")).toBe("http://localhost:3000/dashboard");
    });

    it("allows authed user to access protected routes", async () => {
      const req = createMockRequest("http://localhost:3000/protected", mockSession);
      const res = await (middleware as any)(req);

      expect(res.status).toBe(200);
    });

    it("allows authed user to access protected API routes", async () => {
      const req = createMockRequest("http://localhost:3000/api/protected-data", mockSession);
      const res = await (middleware as any)(req);

      expect(res.status).toBe(200);
    });
  });

  describe("static assets bypass (matcher config)", () => {
    const matcherPattern = config.matcher[0];
    const matcherRegex = new RegExp(`^${matcherPattern}$`);

    it("bypasses static files and image assets", () => {
      const staticPaths = [
        "/_next/static/chunks/main.js",
        "/_next/static/css/app.css",
        "/_next/image",
        "/favicon.ico",
        "/icons/broccoli.svg",
        "/images/logo.png",
        "/photos/food.jpg",
        "/photos/stall.jpeg",
        "/loaders/spinner.gif",
        "/hero.webp",
      ];

      for (const path of staticPaths) {
        expect(matcherRegex.test(path)).toBe(false);
      }
    });

    it("matches application page routes and API routes", () => {
      const appPaths = [
        "/",
        "/protected",
        "/dashboard",
        "/expenses",
        "/close",
        "/login",
        "/login/",
        "/api/sheets",
        "/api/close",
      ];

      for (const path of appPaths) {
        expect(matcherRegex.test(path)).toBe(true);
      }
    });
  });
});
