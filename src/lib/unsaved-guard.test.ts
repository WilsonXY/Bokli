import { describe, it, expect } from "vitest";
import { resolveHistoryDelta } from "./unsaved-guard";

describe("resolveHistoryDelta", () => {
  it("computes negative delta for browser Back traversal", () => {
    expect(resolveHistoryDelta({ __bokliIdx: 1 }, 2)).toBe(-1);
    expect(resolveHistoryDelta({ __bokliIdx: 0 }, 3)).toBe(-3);
  });

  it("computes positive delta for browser Forward traversal", () => {
    expect(resolveHistoryDelta({ __bokliIdx: 2 }, 1)).toBe(1);
    expect(resolveHistoryDelta({ __bokliIdx: 4 }, 1)).toBe(3);
  });

  it("falls back to -1 when destination state has no stamped index", () => {
    expect(resolveHistoryDelta(null, 2)).toBe(-1);
    expect(resolveHistoryDelta({}, 2)).toBe(-1);
    expect(resolveHistoryDelta({ __bokliIdx: 2 }, 2)).toBe(-1);
    expect(resolveHistoryDelta({ __bokliIdx: 0 }, -1)).toBe(-1);
  });
});
