import { describe, expect, it } from "vitest";
import { resolveActiveMonthView } from "./months";
import type { MonthStatus, MonthTile } from "@/services/dashboard";

function tile(month: string, status: MonthStatus = "open"): MonthTile {
  return {
    month,
    revenueSen: 0n,
    dailyCostSen: 0n,
    grossSen: 0n,
    operatingSen: 0n,
    netSen: 0n,
    status,
  };
}

const CURRENT = "2026-09";
// listMonthTiles order: newest first
const TILES = [
  tile("2026-11"),
  tile("2026-08", "closed"),
  tile("2026-06", "reopened"),
];

describe("resolveActiveMonthView", () => {
  it.each<{
    name: string;
    requested: string | undefined;
    tiles: MonthTile[];
    activeMonth: string;
    availableMonths: string[];
  }>([
    {
      name: "valid requested month wins",
      requested: "2026-06",
      tiles: TILES,
      activeMonth: "2026-06",
      availableMonths: ["2026-09", "2026-08", "2026-06"],
    },
    {
      name: "valid requested month without a tile is still offered",
      requested: "2025-01",
      tiles: TILES,
      activeMonth: "2025-01",
      availableMonths: ["2026-09", "2026-08", "2026-06", "2025-01"],
    },
    {
      name: "invalid requested month falls back to first non-future tile",
      requested: "2026-13",
      tiles: TILES,
      activeMonth: "2026-08",
      availableMonths: ["2026-09", "2026-08", "2026-06"],
    },
    {
      name: "no requested month falls back to first non-future tile",
      requested: undefined,
      tiles: TILES,
      activeMonth: "2026-08",
      availableMonths: ["2026-09", "2026-08", "2026-06"],
    },
    {
      name: "future requested month is clamped to current KL month",
      requested: "2026-11",
      tiles: TILES,
      activeMonth: CURRENT,
      availableMonths: ["2026-09", "2026-08", "2026-06"],
    },
    {
      name: "empty tiles fall back to current KL month",
      requested: undefined,
      tiles: [],
      activeMonth: CURRENT,
      availableMonths: ["2026-09"],
    },
    {
      name: "tiles only in the future fall back to current KL month",
      requested: undefined,
      tiles: [tile("2027-01"), tile("2026-10")],
      activeMonth: CURRENT,
      availableMonths: ["2026-09"],
    },
  ])("$name", ({ requested, tiles, activeMonth, availableMonths }) => {
    const view = resolveActiveMonthView(requested, tiles, CURRENT);
    expect(view.activeMonth).toBe(activeMonth);
    expect(view.availableMonths).toEqual(availableMonths);
    expect(view.monthOptions.map((o) => o.month)).toEqual(availableMonths);
  });

  it("passes tile status through (incl. reopened) and defaults tile-less months to open", () => {
    const view = resolveActiveMonthView(undefined, TILES, CURRENT);
    expect(view.monthOptions).toEqual([
      { month: "2026-09", status: "open" },
      { month: "2026-08", status: "closed" },
      { month: "2026-06", status: "reopened" },
    ]);
  });
});
