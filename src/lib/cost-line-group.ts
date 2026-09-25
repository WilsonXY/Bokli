/**
 * The single Cost Line merge rule, shared by the Daily Sheet form (client) and
 * `replaceCostLines` (server).
 *
 * Identity: Cost Category + trimmed note. A null, missing, empty or
 * whitespace-only note all mean "no note" and group together. Groups keep
 * first-seen order and sum their amounts exactly; a sum that leaves the safe
 * integer range throws `CostLineAmountOverflowError` instead of clamping, so a
 * merge can never silently change what the Operator entered.
 *
 * Pure and dependency-free so it is safe in the client bundle. Callers own
 * validation (category, note type, positive amounts) and error mapping.
 */

export interface GroupableCostLine {
  category: string;
  note?: unknown;
  amountSen: number | bigint;
}

export interface CostLineGroup<T extends GroupableCostLine> {
  category: T["category"];
  /** Trimmed note of the first member; null when it has none. */
  note: string | null;
  /** Exact sum of the members' amounts (a safe integer). */
  amountSen: number;
  /** Members in input order; `members[0]` is the first-seen line. */
  members: T[];
  /** Input positions of the members, parallel to `members`. */
  indexes: number[];
}

/**
 * Thrown when an input amount is not a non-negative safe integer, or when a
 * group's summed amount would exceed Number.MAX_SAFE_INTEGER.
 * `index` is the input position of the line that could not be added.
 */
export class CostLineAmountOverflowError extends RangeError {
  constructor(public readonly index: number, message: string) {
    super(message);
    this.name = "CostLineAmountOverflowError";
  }
}

export function normalizeCostLineNote(note: unknown): string | null {
  if (typeof note !== "string") return null;
  return note.trim() || null;
}

export function costLineIdentityKey(category: string, note: unknown): string {
  return `${category}\u0000${normalizeCostLineNote(note) ?? ""}`;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function toSafeSen(amount: number | bigint, index: number): bigint {
  const value =
    typeof amount === "bigint"
      ? amount
      : Number.isSafeInteger(amount)
        ? BigInt(amount)
        : null;
  if (value === null || value < 0n || value > MAX_SAFE) {
    throw new CostLineAmountOverflowError(
      index,
      `Cost Line amount at index ${index} is not a safe non-negative integer (sen): ${String(amount)}`,
    );
  }
  return value;
}

export function groupCostLines<T extends GroupableCostLine>(
  lines: readonly T[],
): CostLineGroup<T>[] {
  const groups: CostLineGroup<T>[] = [];
  const totals: bigint[] = [];
  const byKey = new Map<string, number>();

  lines.forEach((line, index) => {
    const amount = toSafeSen(line.amountSen, index);
    const key = costLineIdentityKey(line.category, line.note);
    const groupIdx = byKey.get(key);

    if (groupIdx === undefined) {
      byKey.set(key, groups.length);
      totals.push(amount);
      groups.push({
        category: line.category,
        note: normalizeCostLineNote(line.note),
        amountSen: Number(amount),
        members: [line],
        indexes: [index],
      });
      return;
    }

    const total = totals[groupIdx] + amount;
    if (total > MAX_SAFE) {
      throw new CostLineAmountOverflowError(
        index,
        `Merged Cost Line amount exceeds maximum safe amount (${Number.MAX_SAFE_INTEGER} sen), received: ${total.toString()}`,
      );
    }
    totals[groupIdx] = total;
    const group = groups[groupIdx];
    group.amountSen = Number(total);
    group.members.push(line);
    group.indexes.push(index);
  });

  return groups;
}
