import type { D1Database } from "@cloudflare/workers-types";
import type { BatchItem, BatchResponse } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/db/schema";

/** Additive async boundary; never opens a SQLite file or guesses a binding. */
export function createD1Adapter(binding: D1Database | undefined) {
  if (!binding) throw new Error("D1 binding is required");
  return drizzle(binding, { schema });
}

/** D1 batch is atomic; interactive BEGIN/COMMIT transactions are not supported. */
export async function runD1Batch<T extends [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]>(
  db: ReturnType<typeof createD1Adapter>,
  queries: T,
  triggerMessages: readonly string[] = [],
): Promise<BatchResponse<T>> {
  try {
    return await db.batch(queries);
  } catch (cause) {
    const message = cause instanceof Error
      ? cause.message.replace(/^D1_ERROR: /, "").replace(/: SQLITE_CONSTRAINT(?:_[A-Z]+)?$/, "")
      : "";
    const kind = triggerMessages.includes(message) ? "trigger"
      : message.startsWith("FOREIGN KEY constraint failed") ? "foreign-key"
      : message.startsWith("CHECK constraint failed:") ? "check"
      : message.startsWith("UNIQUE constraint failed:") ? "unique" : "unknown";
    throw new D1BatchError(kind, cause);
  }
}

export class D1BatchError extends Error {
  constructor(readonly kind: "foreign-key" | "check" | "unique" | "trigger" | "unknown", cause: unknown) {
    super(`D1 batch failed (${kind})`, { cause });
    this.name = "D1BatchError";
  }
}
