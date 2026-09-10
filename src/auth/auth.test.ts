import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { openDb, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { users } from "@/db/schema";
import { seedUsers } from "@/db/seed";
import { resetPassword, readPassword } from "@/cli/reset-password";
import { hashPassword, verifyPassword } from "./password";
import { authConfig, SESSION_MAX_AGE } from "./config";
import { authGuard, withAuth, isProtectedApiPath } from "./guard";
import { handlers } from "./index";
import { GET as bookkeepingGet } from "../../app/api/bookkeeping/route";
import middleware from "../../middleware";

let tmpDir: string;
let dbPath: string;
let db: Db;
let sqlite: import("better-sqlite3").Database;
const originalDbPath = process.env.BOKLI_DB_PATH;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-auth-test-"));
  dbPath = path.join(tmpDir, "test.db");
  process.env.BOKLI_DB_PATH = dbPath;

  const opened = openDb(dbPath);
  db = opened.db;
  sqlite = opened.sqlite;
  runMigrations(dbPath);
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (originalDbPath) {
    process.env.BOKLI_DB_PATH = originalDbPath;
  } else {
    delete process.env.BOKLI_DB_PATH;
  }
});

describe("password hashing & verify", () => {
  it("hashes password and verifies successfully", async () => {
    const raw = "super-secret-pass";
    const hash = await hashPassword(raw);

    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(await verifyPassword(raw, hash)).toBe(true);
    expect(await verifyPassword("wrong-pass", hash)).toBe(false);
  });

  it("handles empty and invalid passwords safely", async () => {
    await expect(hashPassword("")).rejects.toThrow(/empty/i);
    expect(await verifyPassword("", "somehash")).toBe(false);
    expect(await verifyPassword("somepass", "")).toBe(false);
  });
});

describe("session duration and secret config", () => {
  it("configures ~30-day sessions (30 * 24h)", () => {
    const expectedSeconds = 30 * 24 * 60 * 60; // 2,592,000
    expect(SESSION_MAX_AGE).toBe(expectedSeconds);
    expect(authConfig.session?.maxAge).toBe(expectedSeconds);
    expect(authConfig.session?.strategy).toBe("jwt");
  });

  it("configures ~30-day cookie maxAge", () => {
    const sessionCookie = authConfig.cookies?.sessionToken;
    expect(sessionCookie?.options?.maxAge).toBe(30 * 24 * 60 * 60);
    expect(sessionCookie?.options?.httpOnly).toBe(true);
  });

  it("uses random ephemeral secret per process in non-prod/build phase and fails closed in production", () => {
    // 1. In dev/build phase without AUTH_SECRET, generates an ephemeral secret (not a static committed fallback)
    const buildOutput1 = execSync(
      'npx tsx -e "delete process.env.AUTH_SECRET; delete process.env.NEXTAUTH_SECRET; process.env.NODE_ENV = \\"production\\"; process.env.NEXT_PHASE = \\"phase-production-build\\"; import(\\"./src/auth/config.ts\\").then(m => console.log(m.default.authConfig.secret))"',
      { stdio: "pipe", encoding: "utf-8" },
    ).trim();

    expect(buildOutput1.length).toBeGreaterThanOrEqual(32);
    expect(buildOutput1).not.toBe("bokli-build-phase-ephemeral-secret-32-chars-long");

    // Two separate processes in build phase generate distinct secrets (per-process random)
    const buildOutput2 = execSync(
      'npx tsx -e "delete process.env.AUTH_SECRET; delete process.env.NEXTAUTH_SECRET; process.env.NODE_ENV = \\"production\\"; process.env.NEXT_PHASE = \\"phase-production-build\\"; import(\\"./src/auth/config.ts\\").then(m => console.log(m.default.authConfig.secret))"',
      { stdio: "pipe", encoding: "utf-8" },
    ).trim();
    expect(buildOutput1).not.toBe(buildOutput2);

    // 2. In production runtime without AUTH_SECRET, importing throws Error (fails closed)
    expect(() => {
      execSync(
        'npx tsx -e "delete process.env.AUTH_SECRET; delete process.env.NEXTAUTH_SECRET; delete process.env.NEXT_PHASE; delete process.env.npm_lifecycle_event; process.env.NODE_ENV = \\"production\\"; import(\\"./src/auth/config.ts\\")"',
        { stdio: "pipe", encoding: "utf-8" },
      );
    }).toThrow();
  });
});

describe("seeded family users (db:seed)", () => {
  it("idempotently seeds 'mom' (Operator) and 'katte' (Admin) from env vars", async () => {
    process.env.BOKLI_MOM_PASSWORD = "mom-secret-123";
    process.env.BOKLI_ADMIN_PASSWORD = "katte-secret-456";

    // First seed run
    await seedUsers(db);

    const allUsers = db.select().from(users).all();
    expect(allUsers).toHaveLength(2);

    const mom = allUsers.find((u) => u.username === "mom");
    const katte = allUsers.find((u) => u.username === "katte");

    expect(mom).toBeDefined();
    expect(mom?.role).toBe("Operator");
    expect(await verifyPassword("mom-secret-123", mom!.passwordHash)).toBe(true);

    expect(katte).toBeDefined();
    expect(katte?.role).toBe("Admin");
    expect(await verifyPassword("katte-secret-456", katte!.passwordHash)).toBe(true);

    // Second seed run (must be idempotent, no UNIQUE error)
    process.env.BOKLI_MOM_PASSWORD = "mom-new-password";
    await seedUsers(db);

    const afterSecondSeed = db.select().from(users).all();
    expect(afterSecondSeed).toHaveLength(2);

    const updatedMom = afterSecondSeed.find((u) => u.username === "mom");
    expect(await verifyPassword("mom-new-password", updatedMom!.passwordHash)).toBe(true);
  });

  it("fails loudly if required password env vars are missing", async () => {
    const prevMom = process.env.BOKLI_MOM_PASSWORD;
    delete process.env.BOKLI_MOM_PASSWORD;

    await expect(seedUsers(db)).rejects.toThrow(/BOKLI_MOM_PASSWORD/);

    process.env.BOKLI_MOM_PASSWORD = prevMom;
  });
});

describe("auth guard", () => {
  it("identifies protected vs public API paths", () => {
    expect(isProtectedApiPath("/api/bookkeeping")).toBe(true);
    expect(isProtectedApiPath("/api/daily-sheets")).toBe(true);
    expect(isProtectedApiPath("/api/auth/signin")).toBe(false);
    expect(isProtectedApiPath("/api/auth/callback/credentials")).toBe(false);
    expect(isProtectedApiPath("/api/auth/csrf")).toBe(false);
    expect(isProtectedApiPath("/")).toBe(false);
  });

  it("rejects anonymous request to protected route with 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/bookkeeping");
    const res = await authGuard(req, null);

    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = await res!.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("allows authenticated session through the auth guard", async () => {
    const req = new NextRequest("http://localhost:3000/api/bookkeeping");
    const authenticatedSession = {
      user: { id: "1", name: "mom", role: "Operator" as const },
    };

    const res = await authGuard(req, authenticatedSession);
    expect(res).toBeNull(); // null indicates allowed to proceed
  });

  it("withAuth route wrapper blocks anonymous requests", async () => {
    const mockHandler = withAuth(async (_req, session) => {
      return new Response(JSON.stringify({ ok: true, user: session.user }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const anonReq = new NextRequest("http://localhost:3000/api/bookkeeping");
    const anonRes = await mockHandler(anonReq);
    expect(anonRes.status).toBe(401);
  });

  it("protects bookkeeping API route handler directly", async () => {
    // Calling the route handler anonymously returns 401
    const anonReq = new NextRequest("http://localhost:3000/api/bookkeeping");
    const anonRes = await bookkeepingGet(anonReq);
    expect(anonRes.status).toBe(401);
  });

  it("middleware rejects anonymous access to /api/bookkeeping and allows /api/auth/*", async () => {
    const anonReq = new NextRequest("http://localhost:3000/api/bookkeeping");
    const mwRes = (await middleware(anonReq, {} as any)) as Response;
    expect(mwRes.status).toBe(401);

    const authReq = new NextRequest("http://localhost:3000/api/auth/csrf");
    const authMwRes = (await middleware(authReq, {} as any)) as Response;
    expect(authMwRes.status).toBe(200);
  });

  it("middleware redirects anonymous page access to /login with callbackUrl and allows anonymous /login", async () => {
    const homeReq = new NextRequest("http://localhost:3000/");
    const homeRes = (await middleware(homeReq, {} as any)) as Response;
    expect(homeRes.status).toBe(307);
    expect(homeRes.headers.get("location")).toBe("http://localhost:3000/login?callbackUrl=%2F");

    const dashReq = new NextRequest("http://localhost:3000/dashboard?month=2026-03");
    const dashRes = (await middleware(dashReq, {} as any)) as Response;
    expect(dashRes.status).toBe(307);
    expect(dashRes.headers.get("location")).toBe("http://localhost:3000/login?callbackUrl=%2Fdashboard%3Fmonth%3D2026-03");

    const loginReq = new NextRequest("http://localhost:3000/login");
    const loginRes = (await middleware(loginReq, {} as any)) as Response;
    expect(loginRes.status).toBe(200);

    const loginTrailingReq = new NextRequest("http://localhost:3000/login/");
    const loginTrailingRes = (await middleware(loginTrailingReq, {} as any)) as Response;
    expect(loginTrailingRes.status).toBe(200);
  });
});

describe("end-to-end credentials login and API access", () => {
  it("allows seeded 'mom' to log in via credentials POST and access protected API route", async () => {
    // 1. Fetch CSRF token
    const csrfReq = new NextRequest("http://localhost:3000/api/auth/csrf");
    const csrfRes = await handlers.GET(csrfReq);
    const csrfData = (await csrfRes.json()) as { csrfToken: string };
    const csrfCookie = csrfRes.headers.get("set-cookie")?.split(";")[0] ?? "";

    // 2. Submit credentials POST
    const postReq = new NextRequest("http://localhost:3000/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: csrfCookie,
      },
      body: new URLSearchParams({
        username: "mom",
        password: "mom-new-password",
        csrfToken: csrfData.csrfToken,
      }).toString(),
    });

    const loginRes = await handlers.POST(postReq);
    const setCookieHeader = loginRes.headers.get("set-cookie") ?? "";
    const sessionTokenCookie = setCookieHeader
      .split(",")
      .find((c) => c.includes("authjs.session-token"))
      ?.split(";")[0]
      ?.trim();

    expect(sessionTokenCookie).toBeDefined();

    // 3. Verify session endpoint returns Operator role
    const sessionReq = new NextRequest("http://localhost:3000/api/auth/session", {
      headers: { Cookie: sessionTokenCookie! },
    });
    const sessionRes = await handlers.GET(sessionReq);
    const session = (await sessionRes.json()) as any;

    expect(sessionRes.status).toBe(200);
    expect(session.user.name).toBe("mom");
    expect(session.user.role).toBe("Operator");

    // 4. Access protected bookkeeping route with session cookie
    const bookkeepingReq = new NextRequest("http://localhost:3000/api/bookkeeping", {
      headers: {
        Cookie: sessionTokenCookie!,
        "x-forwarded-proto": "http",
        Host: "localhost:3000",
      },
    });
    const bookkeepingRes = await bookkeepingGet(bookkeepingReq);
    expect(bookkeepingRes.status).toBe(200);
    const body = (await bookkeepingRes.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.user.name).toBe("mom");
    expect(body.user.role).toBe("Operator");

    // 5. Verify middleware allows authenticated session
    const mwAuthReq = new NextRequest("http://localhost:3000/api/bookkeeping", {
      headers: {
        Cookie: sessionTokenCookie!,
        "x-forwarded-proto": "http",
        Host: "localhost:3000",
      },
    });
    const mwRes = (await middleware(mwAuthReq, {} as any)) as Response;
    expect(mwRes.status).toBe(200);

    // 6. Verify middleware allows authenticated page access and redirects from /login
    const mwHomeReq = new NextRequest("http://localhost:3000/", {
      headers: {
        Cookie: sessionTokenCookie!,
        "x-forwarded-proto": "http",
        Host: "localhost:3000",
      },
    });
    const mwHomeRes = (await middleware(mwHomeReq, {} as any)) as Response;
    expect(mwHomeRes.status).toBe(200);

    const mwLoginReq = new NextRequest("http://localhost:3000/login", {
      headers: {
        Cookie: sessionTokenCookie!,
        "x-forwarded-proto": "http",
        Host: "localhost:3000",
      },
    });
    const mwLoginRes = (await middleware(mwLoginReq, {} as any)) as Response;
    expect(mwLoginRes.status).toBe(307);
    expect(mwLoginRes.headers.get("location")).toBe("http://localhost:3000/");

    const mwLoginTrailingReq = new NextRequest("http://localhost:3000/login/", {
      headers: {
        Cookie: sessionTokenCookie!,
        "x-forwarded-proto": "http",
        Host: "localhost:3000",
      },
    });
    const mwLoginTrailingRes = (await middleware(mwLoginTrailingReq, {} as any)) as Response;
    expect(mwLoginTrailingRes.status).toBe(307);
    expect(mwLoginTrailingRes.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("rejects login with incorrect password", async () => {
    const csrfReq = new NextRequest("http://localhost:3000/api/auth/csrf");
    const csrfRes = await handlers.GET(csrfReq);
    const csrfData = (await csrfRes.json()) as { csrfToken: string };
    const csrfCookie = csrfRes.headers.get("set-cookie")?.split(";")[0] ?? "";

    const postReq = new NextRequest("http://localhost:3000/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: csrfCookie,
      },
      body: new URLSearchParams({
        username: "mom",
        password: "wrong-password",
        csrfToken: csrfData.csrfToken,
      }).toString(),
    });

    const loginRes = await handlers.POST(postReq);
    const setCookie = loginRes.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain("authjs.session-token");
  });
});

describe("CLI password reset", () => {
  it("resets password for an existing user", async () => {
    const userBefore = db
      .select()
      .from(users)
      .where(eq(users.username, "katte"))
      .get()!;

    const result = await resetPassword("katte", "brand-new-admin-pass", db);
    expect(result.success).toBe(true);
    expect(result.username).toBe("katte");

    const userAfter = db
      .select()
      .from(users)
      .where(eq(users.username, "katte"))
      .get()!;

    expect(userAfter.passwordHash).not.toBe(userBefore.passwordHash);
    expect(await verifyPassword("brand-new-admin-pass", userAfter.passwordHash)).toBe(true);
    expect(await verifyPassword("katte-secret-456", userAfter.passwordHash)).toBe(false);
  });

  it("rejects reset for unknown user or empty password", async () => {
    await expect(resetPassword("unknown-person", "password123", db)).rejects.toThrow(
      /not found/i,
    );
    await expect(resetPassword("katte", "", db)).rejects.toThrow(/empty/i);
    await expect(resetPassword("", "password123", db)).rejects.toThrow(/required/i);
  });

  it("reads password from a stream (stdin simulation)", async () => {
    const stream = Readable.from(["cli-piped-password\n"]);
    const password = await readPassword(stream);
    expect(password).toBe("cli-piped-password");
  });
});
