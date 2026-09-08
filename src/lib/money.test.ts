import { describe, expect, it } from "vitest";

import {
  formatMyr,
  isValidDateStr,
  isValidMonthStr,
  parseSen,
  subSen,
  sumSen,
  MoneyFormatError,
  MoneyRangeError,
} from "./money";

describe("parseSen", () => {
  it("parses basic decimal strings", () => {
    expect(parseSen("12.34")).toBe(1234n);
    expect(parseSen("0.05")).toBe(5n);
    expect(parseSen("12")).toBe(1200n);
    expect(parseSen("12.3")).toBe(1230n);
    expect(parseSen("-1.50")).toBe(-150n);
    expect(parseSen(" 7.25 ")).toBe(725n);
  });

  it("rejects malformed input", () => {
    expect(() => parseSen("")).toThrow(MoneyFormatError);
    expect(() => parseSen("12.345")).toThrow(MoneyFormatError);
    expect(() => parseSen("abc")).toThrow(MoneyFormatError);
    expect(() => parseSen("1,234")).toThrow(MoneyFormatError);
    expect(() => parseSen("RM5")).toThrow(MoneyFormatError);
  });
});

describe("formatMyr", () => {
  it("formats sen to RM strings", () => {
    expect(formatMyr(1234n)).toBe("RM12.34");
    expect(formatMyr(5n)).toBe("RM0.05");
    expect(formatMyr(0n)).toBe("RM0.00");
    expect(formatMyr(-150n)).toBe("-RM1.50");
  });

  it("round-trips with parseSen", () => {
    for (const s of ["0", "12.34", "99.99", "1000.01"]) {
      expect(formatMyr(parseSen(s))).toMatch(/^-?RM\d+\.\d\d$/);
    }
  });
});

describe("arithmetic", () => {
  it("sums sen exactly (no float drift)", () => {
    expect(sumSen([1n, 2n, 3n])).toBe(6n);
    expect(sumSen([parseSen("0.1"), parseSen("0.2")])).toBe(30n);
    expect(sumSen([])).toBe(0n);
  });

  it("subtracts sen", () => {
    expect(subSen(500n, 300n)).toBe(200n);
    expect(subSen(100n, 250n)).toBe(-150n);
  });

  it("rejects out-of-range results", () => {
    const big = 9_007_199_254_740_991n;
    expect(() => sumSen([big, 1n])).toThrow(MoneyRangeError);
  });
});

describe("date helpers", () => {
  it("validates YYYY-MM-DD", () => {
    expect(isValidDateStr("2026-09-07")).toBe(true);
    expect(isValidDateStr("2026-02-29")).toBe(false); // not a leap year
    expect(isValidDateStr("2024-02-29")).toBe(true);
    expect(isValidDateStr("2026-13-01")).toBe(false);
    expect(isValidDateStr("2026-09-31")).toBe(false);
    expect(isValidDateStr("07-09-2026")).toBe(false);
  });

  it("validates YYYY-MM", () => {
    expect(isValidMonthStr("2026-09")).toBe(true);
    expect(isValidMonthStr("2026-13")).toBe(false);
    expect(isValidMonthStr("2026-9")).toBe(false);
  });
});
