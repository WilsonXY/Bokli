import { defineConfig } from "drizzle-kit";

// Fail closed: never fall back to ./data/bokli.db (the PROD DB in the prod checkout).
const dbPath = process.env.BOKLI_DB_PATH?.trim();
if (!dbPath) {
  throw new Error(
    "BOKLI_DB_PATH is not set. drizzle-kit refuses to guess a database path. " +
      "Export BOKLI_DB_PATH (dev: the data-dev/ path from .env.local; prod: the path from .env).",
  );
}

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: dbPath,
  },
});
