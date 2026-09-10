import { describe, expect, it } from "vitest";

import { formatKlDate, formatKlDateTime } from "./datetime";

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
