import { describe, expect, it } from "vitest";

import {
  formatMyr,
  isValidDateStr,
  isValidMonthStr,
  parseSen,
  sanitizeMoneyInput,
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

describe("sanitizeMoneyInput", () => {
  it("accepts valid typing and intermediate numbers", () => {
    expect(sanitizeMoneyInput("")).toBe("");
    expect(sanitizeMoneyInput("12")).toBe("12");
    expect(sanitizeMoneyInput("12.")).toBe("12.");
    expect(sanitizeMoneyInput("12.3")).toBe("12.3");
    expect(sanitizeMoneyInput("12.34")).toBe("12.34");
    expect(sanitizeMoneyInput(".5")).toBe(".5");
  });

  it("cleans pasted formatted values", () => {
    expect(sanitizeMoneyInput("RM 50.00")).toBe("50.00");
    expect(sanitizeMoneyInput("RM50")).toBe("50");
    expect(sanitizeMoneyInput("1,250.00")).toBe("1250.00");
  });

  it("rejects invalid letters and extra decimals", () => {
    expect(sanitizeMoneyInput("weee")).toBeNull();
    expect(sanitizeMoneyInput("12.345")).toBeNull();
    expect(sanitizeMoneyInput("-10")).toBeNull();
    expect(sanitizeMoneyInput("12.3.4")).toBeNull();
    expect(sanitizeMoneyInput("abc123")).toBeNull();
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
    expect(() => sumSen([9007199254740991n, 1n])).toThrow(MoneyRangeError);
  });
});

describe("isValidDateStr", () => {
  it("validates standard YYYY-MM-DD format", () => {
    expect(isValidDateStr("2026-03-31")).toBe(true);
    expect(isValidDateStr("2026-02-28")).toBe(true);
    expect(isValidDateStr("2024-02-29")).toBe(true); // leap year
    expect(isValidDateStr("2026-02-29")).toBe(false); // 2026 is not a leap year
  });

  it("rejects invalid patterns", () => {
    expect(isValidDateStr("2026-13-01")).toBe(false);
    expect(isValidDateStr("2026-09-31")).toBe(false); // September has 30 days
    expect(isValidDateStr("invalid-date")).toBe(false);
    expect(isValidDateStr("2026-3-5")).toBe(false);
  });
});

describe("isValidMonthStr", () => {
  it("validates standard YYYY-MM format", () => {
    expect(isValidMonthStr("2026-03")).toBe(true);
    expect(isValidMonthStr("2026-12")).toBe(true);
  });

  it("rejects invalid patterns", () => {
    expect(isValidMonthStr("2026-13")).toBe(false);
    expect(isValidMonthStr("2026-00")).toBe(false);
    expect(isValidMonthStr("2026")).toBe(false);
  });
});
