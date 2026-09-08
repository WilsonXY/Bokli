import { sql } from "drizzle-orm";

import { hashPassword } from "@/auth/password";
import { openDb, type Db } from "./index";
import { users, type UserRole } from "./schema";

export interface SeedOptions {
  momPassword?: string;
  adminPassword?: string;
}

/**
 * Seeds the two family users ('mom' as Operator and 'katte' as Admin).
 * Passwords are taken from env vars BOKLI_MOM_PASSWORD and BOKLI_ADMIN_PASSWORD,
 * falling back to local defaults if unset.
 * Idempotently upserts using ON CONFLICT DO UPDATE.
 */
export async function seedUsers(db: Db, options: SeedOptions = {}) {
  const momPassword = options.momPassword ?? process.env.BOKLI_MOM_PASSWORD;
  const adminPassword = options.adminPassword ?? process.env.BOKLI_ADMIN_PASSWORD;
  if (!momPassword || !adminPassword) {
    throw new Error(
      "Seeding requires BOKLI_MOM_PASSWORD and BOKLI_ADMIN_PASSWORD (or explicit options). " +
      "Default credentials are intentionally not provided."
    );
  }

  const momHash = await hashPassword(momPassword);
  const adminHash = await hashPassword(adminPassword);

  const initialUsers: Array<{
    username: string;
    passwordHash: string;
    role: UserRole;
  }> = [
    {
      username: "mom",
      passwordHash: momHash,
      role: "Operator",
    },
    {
      username: "katte",
      passwordHash: adminHash,
      role: "Admin",
    },
  ];

  for (const u of initialUsers) {
    db.insert(users)
      .values({
        username: u.username,
        passwordHash: u.passwordHash,
        role: u.role,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: users.username,
        set: {
          passwordHash: u.passwordHash,
          role: u.role,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .run();
  }

  return initialUsers;
}

// Allow CLI execution via `npx tsx src/db/seed.ts` or `npm run db:seed`
if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  const { db } = openDb();
  seedUsers(db)
    .then(() => {
      console.log("Database seeded successfully with family users ('mom', 'katte').");
    })
    .catch((err) => {
      console.error("Failed to seed database:", err);
      process.exit(1);
    });
}
