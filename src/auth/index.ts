import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { getDb } from "@/db";
import { authConfig, SESSION_MAX_AGE } from "./config";
import {
  authenticateCredentials,
  RateLimitedError,
} from "@/services/login-rate-limit";

export { SESSION_MAX_AGE, authConfig, RateLimitedError };

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "credentials",
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        try {
          const { db } = getDb();
          return await authenticateCredentials(
            {
              username: String(credentials.username),
              password: String(credentials.password),
            },
            { db, now: new Date() },
          );
        } catch (err) {
          if (
            err instanceof CredentialsSignin ||
            (err && typeof err === "object" && "code" in err && (err as any).code === "RateLimited")
          ) {
            throw err;
          }
          console.error("Auth authorize error:", err);
          return null;
        }
      },
    }),
  ],
});
