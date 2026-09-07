import type { UserRole } from "@/db/schema";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role?: UserRole;
  }

  interface Session {
    user: {
      id?: string;
      role?: UserRole;
      username?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
    username?: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: UserRole;
    username?: string;
  }
}
