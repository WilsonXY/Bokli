import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@/db/schema";

/**
 * Session duration: ~30 days in seconds (30 * 24h).
 * 30 * 24 * 60 * 60 = 2,592,000 seconds.
 */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

// Align AUTH_URL and NEXTAUTH_URL for parity between v4 and v5 NextAuth tooling
if (!process.env.AUTH_URL && process.env.NEXTAUTH_URL) {
  process.env.AUTH_URL = process.env.NEXTAUTH_URL;
}
if (!process.env.NEXTAUTH_URL && process.env.AUTH_URL) {
  process.env.NEXTAUTH_URL = process.env.AUTH_URL;
}

/**
 * Derives cookie secure flag:
 * - If AUTH_URL/NEXTAUTH_URL is provided, matches its protocol ("https://").
 * - If unset on an https deployment, defaults to true when NODE_ENV=production
 *   to avoid Chromium dropping __Secure- session cookies in a login loop.
 * - In development or test with unset URL, defaults to false (keeps local dev over http working).
 */
export function resolveCookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  const authUrl = env.AUTH_URL ?? env.NEXTAUTH_URL;
  if (authUrl) {
    return authUrl.startsWith("https://");
  }
  return env.NODE_ENV === "production";
}

/**
 * Base NextAuth configuration.
 * Edge-compatible (no node-specific sqlite or native modules)
 * so it can safely be consumed by middleware.
 */
export const authConfig: NextAuthConfig = {
  providers: [],
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE,
  },
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        // Must match the cookie NAME's __Secure- prefix, which @auth/core picks
        // from the site URL's protocol (AUTH_URL if set, else request URL).
        // Mismatches break login two ways:
        // - https site + secure:false -> Chromium silently drops a __Secure-*
        //   cookie without the Secure attr -> session never persists -> infinite
        //   redirect to /login (dev via Tailscale https hit this).
        // - http site + secure:true -> browser stores the cookie but never SENDS
        //   it over http -> same symptom on prod-over-LAN-http.
        // So derive it from AUTH_URL exactly like @auth/core does.
        secure: resolveCookieSecure(),
        maxAge: SESSION_MAX_AGE,
      },
    },
  },
  secret:
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    (() => {
      // Build-phase or non-production fallback to prevent build crashes when AUTH_SECRET is not yet supplied in env.
      // Generate a random ephemeral secret per process so an unset secret never falls back to a forgeable static string.
      if (
        process.env.NODE_ENV !== "production" ||
        process.env.NEXT_PHASE === "phase-production-build" ||
        process.env.npm_lifecycle_event === "build"
      ) {
        return globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID();
      }
      throw new Error("AUTH_SECRET (or NEXTAUTH_SECRET) must be set in production");
    })(),
  trustHost: true,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.username = user.name ?? undefined;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        if (token.role === "Operator" || token.role === "Admin") {
          session.user.role = token.role;
        }
        if (typeof token.username === "string") {
          session.user.username = token.username;
        }
      }
      return session;
    },
  },
};
