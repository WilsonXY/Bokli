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
        secure: process.env.NODE_ENV === "production",
        maxAge: SESSION_MAX_AGE,
      },
    },
  },
  secret:
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    "bokli-auth-secret-change-in-production-long-secret-key",
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
