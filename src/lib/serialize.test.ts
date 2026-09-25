import { describe, expect, it } from "vitest";
import { serializeTile } from "./serialize";
import type { MonthTile } from "@/services/dashboard";

const base = {
  revenueSen: 1234567n,
  dailyCostSen: 200000n,
  grossSen: 1034567n,
  operatingSen: 34567n,
  netSen: 1000000n,
};

describe("serializeTile", () => {
  it("converts bigint sen fields to numbers", () => {
    const out = serializeTile({ month: "2026-08", status: "open", ...base });
    expect(out).toEqual({
      month: "2026-08",
      status: "open",
      revenueSen: 1234567,
      dailyCostSen: 200000,
      grossSen: 1034567,
      operatingSen: 34567,
      netSen: 1000000,
    });
  });

  it("omits balanced for open and reopened months", () => {
    for (const status of ["open", "reopened"] as const) {
      const out = serializeTile({ month: "2026-08", status, ...base });
      expect("balanced" in out).toBe(false);
    }
  });

  it("keeps balanced as-is for closed months", () => {
    const closed = (balanced: boolean): MonthTile => ({
      month: "2026-07",
      status: "closed",
      balanced,
      ...base,
    });
    expect(serializeTile(closed(true)).balanced).toBe(true);
    expect(serializeTile(closed(false)).balanced).toBe(false);
    expect("balanced" in serializeTile(closed(false))).toBe(true);
  });
});
