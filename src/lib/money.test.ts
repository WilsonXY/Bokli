import { describe, expect, it } from "vitest";

import {
  amountSizeClass,
  formatMyr,
  isValidDateStr,
  isValidMonthStr,
  parseSen,
  sanitizeMoneyInput,
  tryParseSen,
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

describe("tryParseSen", () => {
  it("treats blank input as zero sen", () => {
    expect(tryParseSen("")).toBe(0n);
    expect(tryParseSen("   ")).toBe(0n);
  });

  it("parses valid money strings like parseSen", () => {
    expect(tryParseSen("12.34")).toBe(1234n);
    expect(tryParseSen("50")).toBe(5000n);
    expect(tryParseSen("0.5")).toBe(50n);
    expect(tryParseSen(" 7.25 ")).toBe(725n);
    expect(tryParseSen("-1.50")).toBe(-150n);
  });

  it("returns null — never 0n — for unparseable non-empty input", () => {
    expect(tryParseSen("12.")).toBeNull();
    expect(tryParseSen(".")).toBeNull();
    expect(tryParseSen("abc")).toBeNull();
    expect(tryParseSen("12.34.56")).toBeNull();
    expect(tryParseSen("12.345")).toBeNull();
    expect(tryParseSen("--50")).toBeNull();
    expect(tryParseSen("invalid-input")).toBeNull();
    expect(tryParseSen("1,234")).toBeNull();
    expect(tryParseSen("RM5")).toBeNull();
  });

  it("does not swallow range errors into a silent zero", () => {
    expect(tryParseSen("999999999999999999")).toBeNull();
  });
});

describe("sanitizeMoneyInput", () => {
  it("accepts valid numbers, normalizes leading decimals, and allows trailing-dot transient states", () => {
    expect(sanitizeMoneyInput("")).toBe("");
    expect(sanitizeMoneyInput("12")).toBe("12");
    expect(sanitizeMoneyInput("12.")).toBe("12.");
    expect(sanitizeMoneyInput("12.3")).toBe("12.3");
    expect(sanitizeMoneyInput("12.34")).toBe("12.34");
    expect(sanitizeMoneyInput(".5")).toBe("0.5");
  });

  it("cleans pasted formatted values and trims whitespace", () => {
    expect(sanitizeMoneyInput("RM 50.00")).toBe("50.00");
    expect(sanitizeMoneyInput("RM 50.00 ")).toBe("50.00");
    expect(sanitizeMoneyInput("  50.00  ")).toBe("50.00");
    expect(sanitizeMoneyInput("RM50")).toBe("50");
    expect(sanitizeMoneyInput("1,250.00")).toBe("1250.00");
  });

  it("rejects invalid letters, bare dots, and extra decimals", () => {
    expect(sanitizeMoneyInput(".")).toBeNull();
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

describe("amountSizeClass", () => {
  it("returns empty string by default when string length <= 11", () => {
    expect(amountSizeClass("RM500000.00")).toBe("");
    expect(amountSizeClass("RM12.34")).toBe("");
    expect(amountSizeClass("")).toBe("");
  });

  it("returns text-xs by default when string length > 11", () => {
    expect(amountSizeClass("RM1005686.12")).toBe("text-xs");
    expect(amountSizeClass("-RM100000.00")).toBe("text-xs");
  });

  it("supports custom shrinkClass and baseClass", () => {
    expect(amountSizeClass("RM500000.00", "text-2xl", "text-3xl")).toBe("text-3xl");
    expect(amountSizeClass("RM1005686.12", "text-2xl", "text-3xl")).toBe("text-2xl");
    expect(amountSizeClass("RM1005686.12", "text-base", "text-xl")).toBe("text-base");
    expect(amountSizeClass("RM500000.00", "text-base", "text-xl")).toBe("text-xl");
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
