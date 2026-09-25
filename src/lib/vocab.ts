/**
 * Single source of truth for the domain vocabularies (see CONTEXT.md).
 * The DB CHECK constraints in src/db/schema.ts keep literal IN-lists so the
 * generated migration SQL never changes; src/lib/vocab.test.ts asserts they
 * stay in sync with these arrays.
 */

export const COST_CATEGORIES = [
  "restock",
  "gas",
  "transport",
  "wages-daily",
  "maintenance",
  "other",
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

export const OPERATING_EXPENSE_TYPES = [
  "rental",
  "utilities",
  "wages",
  "other",
] as const;

export type OperatingExpenseType = (typeof OPERATING_EXPENSE_TYPES)[number];
