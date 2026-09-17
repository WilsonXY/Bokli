import { describe, it, expect, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import {
  DashboardView,
  getDonutSlice,
  type SerializedCostByCategory,
  type SerializedMonthTile,
} from "./DashboardView";

describe("DashboardView deterministic geometry & hydration stability", () => {
  describe("getDonutSlice boundary and determinism", () => {
    it("deterministically sets largeArc=0 for exact 50% slice and largeArc=1 for >50%", () => {
      // 50% slice (0.0 to 0.5): largeArc should be 0 -> "A 94 94 0 0 1"
      const slice50 = getDonutSlice(100, 100, 94, 48, 0, 0.5);
      expect(slice50.d).toContain("A 94 94 0 0 1");
      expect(slice50.d).not.toContain("A 94 94 0 1 1");

      // 50.01% slice (0.0 to 0.5001): largeArc should be 1 -> "A 94 94 0 1 1"
      const slice50Plus = getDonutSlice(100, 100, 94, 48, 0, 0.5001);
      expect(slice50Plus.d).toContain("A 94 94 0 1 1");

      // Near 50% floating point jitter around 0.5000000000000001 vs 0.5 is rounded cleanly
      const sliceJitter = getDonutSlice(100, 100, 94, 48, 0.1, 0.1 + 0.5000000000000001);
      expect(sliceJitter.d).toContain("A 94 94 0 0 1");
    });

    it("emits fixed 4-decimal coordinates in path string", () => {
      const slice = getDonutSlice(100, 100, 94, 48, 0.123456, 0.456789);
      // All coordinates in path have 4 decimal places
      const coords = slice.d.match(/-?\d+\.\d+/g) || [];
      expect(coords.length).toBeGreaterThan(0);
      for (const c of coords) {
        const decimals = c.split(".")[1];
        expect(decimals.length).toBe(4);
      }
    });

    it("repeated calls with identical parameters yield identical path strings", () => {
      const run1 = getDonutSlice(100, 100, 94, 48, 0.25, 0.75);
      const run2 = getDonutSlice(100, 100, 94, 48, 0.25, 0.75);
      expect(run1.d).toBe(run2.d);
      expect(run1.tx).toBe(run2.tx);
      expect(run1.ty).toBe(run2.ty);
    });
  });

  describe("DashboardView component render reproducibility", () => {
    it("consecutive renders with 50/50 cost split produce identical SVG path 'd' attributes without hydration drift", () => {
      const mockTile: SerializedMonthTile = {
        month: "2026-05",
        status: "open",
        revenueSen: 100000,
        dailyCostSen: 40000,
        grossSen: 60000,
        operatingSen: 10000,
        netSen: 50000,
      };

      const mockProps = {
        tiles: [mockTile],
        activeMonth: "2026-05",
        activeTile: mockTile,
        trend: [
          { date: "2026-05-01", cashSen: 2000, tngSen: 3000, totalSen: 5000 },
          { date: "2026-05-02", cashSen: 2500, tngSen: 3500, totalSen: 6000 },
        ],
        split: {
          cashSen: 4500,
          tngSen: 6500,
          totalSen: 11000,
        },
        costByCategory: {
          restock: 20000, // 50%
          gas: 20000,     // 50%
          transport: 0,
          "wages-daily": 0,
          maintenance: 0,
          other: 0,
        } as SerializedCostByCategory,
      };

      const render1 = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DashboardView, mockProps)
      );
      const render2 = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DashboardView, mockProps)
      );

      // Entire markup is byte-identical
      expect(render1).toBe(render2);

      // Extract all path 'd' attributes and ensure none differ
      const dRegex = /d="([^"]+)"/g;
      const paths1 = Array.from(render1.matchAll(dRegex), (m) => m[1]);
      const paths2 = Array.from(render2.matchAll(dRegex), (m) => m[1]);

      expect(paths1.length).toBeGreaterThan(0);
      expect(paths1).toEqual(paths2);

      // Both 50% slices in donut have largeArc=0 ("A 94 94 0 0 1")
      const donutSlicePaths = paths1.filter((d) => d.includes("A 94"));
      expect(donutSlicePaths.length).toBe(2);
      for (const d of donutSlicePaths) {
        expect(d).toContain("A 94 94 0 0 1");
      }
    });
  });

  describe("headline and 3-way strip amounts dynamic sizing", () => {
    it("applies text-xs on strip amounts longer than 11 characters and keeps base sizing otherwise", () => {
      const mockTile: SerializedMonthTile = {
        month: "2026-05",
        status: "open",
        revenueSen: 100568612, // RM1005686.12 -> 12 characters
        dailyCostSen: 50000000, // RM500000.00 -> 11 characters
        grossSen: 50568612,
        operatingSen: 120000000, // RM1200000.00 -> 12 characters
        netSen: -19431388,
      };

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DashboardView, {
          tiles: [mockTile],
          activeMonth: "2026-05",
          activeTile: mockTile,
          trend: [],
          split: null,
          costByCategory: null,
        })
      );

      // Revenue (12 chars): conditional replacement text-xs sm:text-xl (never coexists with text-sm)
      expect(html).toContain("RM1005686.12");
      expect(html).toMatch(/class="[^"]*text-xs sm:text-xl font-bold text-ink-primary tabular-nums"[^>]*>RM1005686\.12/);
      expect(html).not.toMatch(/class="[^"]*text-sm[^"]*"[^>]*>RM1005686\.12/);

      // Daily cost (11 chars): keeps base text-sm sm:text-xl (never includes text-xs)
      expect(html).toContain("RM500000.00");
      expect(html).toMatch(/class="[^"]*text-sm sm:text-xl font-bold text-slate-700 tabular-nums"[^>]*>RM500000\.00/);
      expect(html).not.toMatch(/class="[^"]*text-xs[^"]*"[^>]*>RM500000\.00/);

      // Operating expenses (12 chars): conditional replacement text-xs sm:text-xl (never coexists with text-sm)
      expect(html).toContain("RM1200000.00");
      expect(html).toMatch(/class="[^"]*text-xs sm:text-xl font-bold text-slate-700 tabular-nums"[^>]*>RM1200000\.00/);
      expect(html).not.toMatch(/class="[^"]*text-sm[^"]*"[^>]*>RM1200000\.00/);
    });

    it("shrinks headline net profit to text-2xl on mobile when longer than 11 characters and keeps text-3xl otherwise", () => {
      // Long headline amount: -RM194313.88 -> 13 characters
      const longTile: SerializedMonthTile = {
        month: "2026-05",
        status: "open",
        revenueSen: 100000,
        dailyCostSen: 50000,
        grossSen: 50000,
        operatingSen: 24431388,
        netSen: -19431388,
      };

      const longHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DashboardView, {
          tiles: [longTile],
          activeMonth: "2026-05",
          activeTile: longTile,
          trend: [],
          split: null,
          costByCategory: null,
        })
      );

      expect(longHtml).toContain("-RM194313.88");
      expect(longHtml).toMatch(/class="[^"]*text-2xl sm:text-4xl font-extrabold tracking-tight tabular-nums text-rose-600"[^>]*>-RM194313\.88/);
      expect(longHtml).not.toMatch(/class="[^"]*text-3xl[^"]*"[^>]*>-RM194313\.88/);

      // Normal headline amount: RM5000.00 -> 9 characters <= 11
      const normalTile: SerializedMonthTile = {
        month: "2026-05",
        status: "open",
        revenueSen: 1000000,
        dailyCostSen: 300000,
        grossSen: 700000,
        operatingSen: 200000,
        netSen: 500000,
      };

      const normalHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DashboardView, {
          tiles: [normalTile],
          activeMonth: "2026-05",
          activeTile: normalTile,
          trend: [],
          split: null,
          costByCategory: null,
        })
      );

      expect(normalHtml).toContain("RM5000.00");
      expect(normalHtml).toMatch(/class="[^"]*text-3xl sm:text-4xl font-extrabold tracking-tight tabular-nums text-emerald-700"[^>]*>RM5000\.00/);
      expect(normalHtml).not.toMatch(/class="[^"]*text-2xl[^"]*"[^>]*>RM5000\.00/);
    });
  });
});
