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
  trendValueSen,
  type SerializedCostByCategory,
  type SerializedMonthTile,
} from "./DashboardView";

describe("DashboardView deterministic geometry & hydration stability", () => {
  describe("DashboardView component render reproducibility", () => {
    it("orders Daily Cost categories by amount so the largest cost is first", () => {
      const html = ReactDOMServer.renderToStaticMarkup(React.createElement(DashboardView, {
        tiles: [], activeMonth: "2026-05", activeTile: null, trend: [], split: null,
        costByCategory: { restock: 10000, gas: 90000, transport: 0, "wages-daily": 0, maintenance: 0, other: 0 },
      }));
      expect(html.indexOf("煤气")).toBeLessThan(html.indexOf("进货"));
    });
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
          { date: "2026-05-01", cashSen: 2000, tngSen: 3000, totalSen: 5000, costSen: 1500 },
          { date: "2026-05-02", cashSen: 2500, tngSen: 3500, totalSen: 6000, costSen: 2500 },
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

      expect(render1).toContain('class="cost-bars"');
      expect(render1.match(/width:50%/g)?.length).toBe(2);
    });

    it("renders the complete amount and 100% bar for a single cost category", () => {
      const mockTile: SerializedMonthTile = {
        month: "2026-05",
        status: "open",
        revenueSen: 100000,
        dailyCostSen: 40000,
        grossSen: 60000,
        operatingSen: 10000,
        netSen: 50000,
      };

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DashboardView, {
          tiles: [mockTile],
          activeMonth: "2026-05",
          activeTile: mockTile,
          trend: [],
          split: null,
          costByCategory: {
            restock: 40000,
            gas: 0,
            transport: 0,
            "wages-daily": 0,
            maintenance: 0,
            other: 0,
          } as SerializedCostByCategory,
        })
      );

      expect(html).toContain('class="cost-bar-row"');
      expect(html).toContain('width:100%');
      expect(html).toContain('RM 400.00');
      expect(html).toContain("100%");
    });
  });

  describe("headline and 3-way strip amounts dynamic sizing", () => {
    it("applies text-xs on strip amounts longer than 11 characters and keeps base sizing otherwise", () => {
      const mockTile: SerializedMonthTile = {
        month: "2026-05",
        status: "open",
        revenueSen: 100568612, // RM 1,005,686.12 -> 12 characters
        dailyCostSen: 500000, // RM 5,000.00 -> 11 characters
        grossSen: 100068612,
        operatingSen: 120000000, // RM 1,200,000.00 -> 12 characters
        netSen: -19931388,
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
      expect(html).toContain("RM 1,005,686.12");
      expect(html).toMatch(/class="[^"]*text-xs sm:text-xl font-bold text-ink-primary tabular-nums"[^>]*>RM 1,005,686\.12/);
      expect(html).not.toMatch(/class="[^"]*text-sm[^"]*"[^>]*>RM 1,005,686\.12/);

      // Daily cost (11 chars): keeps base text-sm sm:text-xl (never includes text-xs)
      expect(html).toContain("-RM 5,000.00");
      expect(html).toMatch(/class="[^"]*text-sm sm:text-xl font-bold text-ink-secondary tabular-nums"[^>]*>-RM 5,000\.00/);
      expect(html).not.toMatch(/class="[^"]*text-xs[^"]*"[^>]*>-RM 5,000\.00/);

      // Operating expenses (12 chars): conditional replacement text-xs sm:text-xl (never coexists with text-sm)
      expect(html).toContain("-RM 1,200,000.00");
      expect(html).toMatch(/class="[^"]*text-xs sm:text-xl font-bold text-ink-secondary tabular-nums"[^>]*>-RM 1,200,000\.00/);
      expect(html).not.toMatch(/class="[^"]*text-sm[^"]*"[^>]*>-RM 1,200,000\.00/);
    });

    it("shrinks headline net profit to text-2xl on mobile when longer than 11 characters and keeps text-3xl otherwise", () => {
      // Long headline amount: -RM 194,313.88 -> 13 characters
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

      expect(longHtml).toContain("-RM 194,313.88");
      expect(longHtml).toMatch(/class="[^"]*text-2xl sm:text-4xl font-extrabold tracking-tight tabular-nums text-finance-loss"[^>]*>-RM 194,313\.88/);
      expect(longHtml).not.toMatch(/class="[^"]*text-3xl[^"]*"[^>]*>-RM 194,313\.88/);

      // Normal headline amount: RM 5,000.00 -> 9 characters <= 11
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

      expect(normalHtml).toContain("RM 5,000.00");
      expect(normalHtml).toMatch(/class="[^"]*text-3xl sm:text-4xl font-extrabold tracking-tight tabular-nums text-finance-profit"[^>]*>RM 5,000\.00/);
      expect(normalHtml).not.toMatch(/class="[^"]*text-2xl[^"]*"[^>]*>RM 5,000\.00/);
    });
  });

  describe("daily trend metric tabs", () => {
    const row = { date: "2026-05-01", cashSen: 2000, tngSen: 3000, totalSen: 5000, costSen: 1500 };

    it("trendValueSen reads revenue from totalSen and Daily Cost from costSen", () => {
      expect(trendValueSen(row, "revenue")).toBe(5000);
      expect(trendValueSen(row, "cost")).toBe(1500);
    });

    it("renders 营业收入 / 日常开销 tabs with the revenue tab selected by default", () => {
      const tile: SerializedMonthTile = {
        month: "2026-05",
        status: "open",
        revenueSen: 5000,
        dailyCostSen: 1500,
        grossSen: 3500,
        operatingSen: 0,
        netSen: 3500,
      };

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DashboardView, {
          tiles: [tile],
          activeMonth: "2026-05",
          activeTile: tile,
          trend: [row],
          split: null,
          costByCategory: null,
        })
      );

      expect(html).toMatch(/<button[^>]*aria-selected="true"[^>]*>营业收入<\/button>/);
      expect(html).toMatch(/<button[^>]*aria-selected="false"[^>]*>日常开销<\/button>/);
      expect(html).toContain("每日收入趋势");
      expect(html).not.toContain("每日开销趋势");
    });
  });
});

describe("DashboardView trend chart metric switch", () => {
  it("uses separate columns and a shared zero-based scale for both metrics", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DashboardView, {
        tiles: [],
        activeMonth: "2026-05",
        activeTile: null,
        trend: [
          { date: "2026-05-01", cashSen: 2000, tngSen: 3000, totalSen: 5000, costSen: 1500 },
          { date: "2026-05-02", cashSen: 2500, tngSen: 3500, totalSen: 6000, costSen: 10000 },
        ],
        split: null,
        costByCategory: null,
      })
    );

    const plot = html.match(/<svg[^>]*class="trend-plot[\s\S]*?<\/svg>/)?.[0] ?? "";
    expect(plot).toContain('data-shared-maximum="15000"');
    const columns = Array.from(plot.matchAll(/<rect class="trend-column" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g), match => match.slice(1).map(Number));
    expect(columns).toHaveLength(2);
    expect(columns[0][0] + columns[0][2]).toBeLessThan(columns[1][0]);
    expect(columns[0][3] / columns[1][3]).toBeCloseTo(50 / 60);
    expect(columns[0][1] + columns[0][3]).toBeCloseTo(columns[1][1] + columns[1][3]);
    expect(plot).not.toContain("<path");
    // The chart fades as one piece when switching measures.
    expect(html).toMatch(/<svg[^>]*class="[^"]*animate-chart-swap/);
  });

  it("keeps the padded scale within the supported money range", () => {
    const html = ReactDOMServer.renderToStaticMarkup(React.createElement(DashboardView, {
      tiles: [], activeMonth: "2026-05", activeTile: null,
      trend: [{date:"2026-05-01",cashSen:Number.MAX_SAFE_INTEGER,tngSen:0,totalSen:Number.MAX_SAFE_INTEGER,costSen:0}],
      split: null, costByCategory: null,
    }));
    expect(html).toContain(`data-shared-maximum="${Number.MAX_SAFE_INTEGER}"`);
    expect(html).toContain("RM 90,071,992,547,409.91");
  });
});
