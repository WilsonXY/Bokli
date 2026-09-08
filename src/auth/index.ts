import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { sql } from "drizzle-orm";

import { openDb } from "@/db";
import { users } from "@/db/schema";
import { authConfig, SESSION_MAX_AGE } from "./config";
import { verifyPassword } from "./password";

export { SESSION_MAX_AGE, authConfig };

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

        const username = String(credentials.username).trim().toLowerCase();
        const password = String(credentials.password);

        try {
          const { db } = openDb();
          const user = db
            .select()
            .from(users)
            .where(sql`lower(${users.username}) = ${username}`)
            .get();

          if (!user) {
            return null;
          }

          const isValid = await verifyPassword(password, user.passwordHash);
          if (!isValid) {
            return null;
          }

          return {
            id: String(user.id),
            name: user.username,
            role: user.role,
          };
        } catch (err) {
          console.error("Auth authorize error:", err);
          return null;
        }
      },
    }),
  ],
});
