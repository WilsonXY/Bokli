import { describe, expect, it } from "vitest";

import {
  formatKlDate,
  formatKlDateTime,
  getTodayInKualaLumpur,
  isFutureDateInKL,
} from "./datetime";

describe("formatKlDateTime", () => {
  it("formats exact production UTC timestamp in Asia/Kuala_Lumpur time", () => {
    expect(formatKlDateTime("2026-09-09T14:14:35.989Z")).toBe("2026-09-09 22:14:35");
  });

  it("handles KL date rollover when UTC date differs from KL date", () => {
    expect(formatKlDateTime("2026-09-09T17:00:00.000Z")).toBe("2026-09-10 01:00:00");
  });

  it("handles pre-midnight edge in KL time", () => {
    expect(formatKlDateTime("2026-09-09T15:59:59.000Z")).toBe("2026-09-09 23:59:59");
  });

  it("defensively returns unparseable string unchanged", () => {
    expect(formatKlDateTime("not-a-date")).toBe("not-a-date");
    expect(formatKlDateTime("")).toBe("");
  });
});

describe("formatKlDate", () => {
  it("formats date in Asia/Kuala_Lumpur with date rollover", () => {
    expect(formatKlDate("2026-09-09T17:00:00.000Z")).toBe("2026-09-10");
  });

  it("formats date matching same calendar day in KL", () => {
    expect(formatKlDate("2026-09-09T14:14:35.989Z")).toBe("2026-09-09");
  });

  it("defensively returns unparseable or empty string unchanged", () => {
    expect(formatKlDate("")).toBe("");
    expect(formatKlDate("not-a-date")).toBe("not-a-date");
  });
});

describe("getTodayInKualaLumpur", () => {
  it("returns KL date as YYYY-MM-DD", () => {
    expect(getTodayInKualaLumpur(new Date("2026-09-07T15:30:00.000Z"))).toBe("2026-09-07");
  });

  it("rolls over at KL midnight while UTC is still the previous day", () => {
    expect(getTodayInKualaLumpur(new Date("2026-09-07T15:59:59.999Z"))).toBe("2026-09-07");
    expect(getTodayInKualaLumpur(new Date("2026-09-07T16:00:00.000Z"))).toBe("2026-09-08");
  });

  it("zero-pads month and day", () => {
    expect(getTodayInKualaLumpur(new Date("2026-01-04T00:00:00.000Z"))).toBe("2026-01-04");
  });

  it("returns a YYYY-MM-DD string when called without arguments", () => {
    expect(getTodayInKualaLumpur()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isFutureDateInKL", () => {
  it("compares against the KL date, not the UTC date", () => {
    const now = new Date("2026-09-07T16:15:00.000Z"); // 2026-09-08 00:15 KL
    expect(isFutureDateInKL("2026-09-07", now)).toBe(false);
    expect(isFutureDateInKL("2026-09-08", now)).toBe(false);
    expect(isFutureDateInKL("2026-09-09", now)).toBe(true);
  });
});
