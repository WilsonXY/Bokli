import { describe, expect, it } from "vitest";

import {
  CostLineAmountOverflowError,
  costLineIdentityKey,
  groupCostLines,
  normalizeCostLineNote,
} from "./cost-line-group";

const MAX = Number.MAX_SAFE_INTEGER;

describe("groupCostLines (single Cost Line merge rule)", () => {
  it("groups by category + trimmed note in first-seen order with exact sums", () => {
    const groups = groupCostLines([
      { category: "gas", amountSen: 500, note: null },
      { category: "restock", amountSen: 2000, note: "Rice" },
      { category: "restock", amountSen: 3000, note: "  Rice  " },
      { category: "gas", amountSen: 700 },
    ]);

    expect(groups.map((g) => [g.category, g.note, g.amountSen])).toEqual([
      ["gas", null, 1200],
      ["restock", "Rice", 5000],
    ]);
    expect(groups[0].indexes).toEqual([0, 3]);
    expect(groups[1].indexes).toEqual([1, 2]);
  });

  it("treats null, missing, empty and whitespace-only notes as the same identity", () => {
    const groups = groupCostLines([
      { category: "gas", amountSen: 1, note: null },
      { category: "gas", amountSen: 2 },
      { category: "gas", amountSen: 3, note: "" },
      { category: "gas", amountSen: 4, note: "   " },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].note).toBeNull();
    expect(groups[0].amountSen).toBe(10);
  });

  it("keeps distinct categories with the same note apart, and notes are case-sensitive", () => {
    const groups = groupCostLines([
      { category: "restock", amountSen: 100, note: "misc" },
      { category: "other", amountSen: 200, note: "misc" },
      { category: "restock", amountSen: 300, note: "Misc" },
    ]);
    expect(groups.map((g) => g.amountSen)).toEqual([100, 200, 300]);
  });

  it("returns the original members so callers can rebuild their own metadata", () => {
    const a = { category: "gas", amountSen: 1, note: "x", tag: "a" };
    const b = { category: "gas", amountSen: 2, note: "x ", tag: "b" };
    const [group] = groupCostLines([a, b]);
    expect(group.members[0]).toBe(a);
    expect(group.members[1]).toBe(b);
  });

  it("accepts a sum landing exactly on MAX_SAFE_INTEGER (bigint and number inputs)", () => {
    const [group] = groupCostLines([
      { category: "gas", amountSen: BigInt(MAX) - 1n },
      { category: "gas", amountSen: 1 },
    ]);
    expect(group.amountSen).toBe(MAX);
  });

  it("throws on merged overflow with the index of the line that could not be added (never clamps)", () => {
    let caught: unknown;
    try {
      groupCostLines([
        { category: "gas", amountSen: 10 },
        { category: "restock", amountSen: MAX },
        { category: "restock", amountSen: 1 },
      ]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CostLineAmountOverflowError);
    expect((caught as CostLineAmountOverflowError).index).toBe(2);
  });

  it("rejects amounts that are not safe non-negative integers", () => {
    for (const amountSen of [MAX + 1, 1.5, -1, Number.NaN, BigInt(MAX) + 1n, -1n]) {
      expect(() => groupCostLines([{ category: "gas", amountSen }])).toThrow(
        CostLineAmountOverflowError,
      );
    }
  });

  it("identity helpers agree with the grouping", () => {
    expect(normalizeCostLineNote("  a ")).toBe("a");
    expect(normalizeCostLineNote("   ")).toBeNull();
    expect(normalizeCostLineNote(42)).toBeNull();
    expect(costLineIdentityKey("gas", null)).toBe(costLineIdentityKey("gas", " "));
    expect(costLineIdentityKey("gas", "a")).not.toBe(costLineIdentityKey("restock", "a"));
  });
});
