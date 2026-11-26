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
  buildCalendarSlots,
  buildRankedCostCategories,
  computeRevenueAllocation,
  previousCalendarMonth,
  trendValueSen,
  type SerializedCostByCategory,
  type SerializedMonthTile,
} from "./DashboardView";

describe("DashboardView deterministic analytics & hydration stability", () => {
  describe("buildRankedCostCategories", () => {
    it("ranks non-zero categories largest-first with exact shares and rounded percentages", () => {
      const ranked = buildRankedCostCategories({
        restock: 20000,
        gas: 10000,
        transport: 0,
        "wages-daily": 30000,
        maintenance: 0,
        other: 0,
      });

      expect(ranked.map((r) => r.cat)).toEqual(["wages-daily", "restock", "gas"]);
      expect(ranked[0].exactShare).toBeCloseTo(0.5, 12);
      expect(ranked[0].pct).toBe(50);
      expect(ranked[1].pct).toBe(33);
      expect(ranked[2].pct).toBe(17);
    });

    it("returns a single 100% entry when all costs belong to one category", () => {
      const ranked = buildRankedCostCategories({
        restock: 4500,
        gas: 0,
        transport: 0,
        "wages-daily": 0,
        maintenance: 0,
        other: 0,
      });

      expect(ranked).toHaveLength(1);
      expect(ranked[0].cat).toBe("restock");
      expect(ranked[0].exactShare).toBe(1);
      expect(ranked[0].pct).toBe(100);
    });

    it("returns an empty array when total is zero or null", () => {
      expect(buildRankedCostCategories(null)).toEqual([]);
      expect(
        buildRankedCostCategories({
          restock: 0,
          gas: 0,
          transport: 0,
          "wages-daily": 0,
          maintenance: 0,
          other: 0,
        })
      ).toEqual([]);
    });
  });

  describe("buildCalendarSlots", () => {
    it("expands recorded days across a calendar-proportional span preserving gaps", () => {
      const slots = buildCalendarSlots("2026-05", [
        { date: "2026-05-01", cashSen: 2000, tngSen: 3000, totalSen: 5000, costSen: 1500 },
        { date: "2026-05-05", cashSen: 2500, tngSen: 3500, totalSen: 6000, costSen: 2500 },
      ]);

      // Minimum 7-day calendar span starting at day 1
      expect(slots.length).toBe(7);
      expect(slots[0].date).toBe("2026-05-01");
      expect(slots[0].row?.totalSen).toBe(5000);
      expect(slots[2].date).toBe("2026-05-03");
      expect(slots[2].row).toBeNull();
      expect(slots[4].date).toBe("2026-05-05");
      expect(slots[4].row?.totalSen).toBe(6000);
    });

    it("returns empty array when trend has no rows", () => {
      expect(buildCalendarSlots("2026-05", [])).toEqual([]);
    });
  });

  describe("previousCalendarMonth & truthful loss-month allocation", () => {
    it("steps strictly to the adjacent calendar month including year rollover", () => {
      expect(previousCalendarMonth("2026-10")).toBe("2026-09");
      expect(previousCalendarMonth("2026-01")).toBe("2025-12");
      expect(previousCalendarMonth("invalid")).toBeNull();
    });

    it("reports truthful single-scale loss allocation with revenue boundary and crimson shortfall", () => {
      const lossTile: SerializedMonthTile = {
        month: "2026-08",
        status: "open",
        revenueSen: 40000, // RM 400
        dailyCostSen: 22000, // RM 220
        grossSen: 18000,
        operatingSen: 35000, // RM 350 -> total outflow RM 570
        netSen: -17000, // -RM 170 shortfall
      };
      const alloc = computeRevenueAllocation(lossTile);
      expect(alloc).not.toBeNull();
      expect(alloc!.isLoss).toBe(true);
      expect(alloc!.hasRevenue).toBe(true);
      expect(alloc!.shortfallSen).toBe(17000);
      expect(alloc!.coveredDailySen).toBe(22000);
      expect(alloc!.coveredOpSen).toBe(18000);
      expect(alloc!.netBarWidth).toBe(0);
      expect(alloc!.dailyBarWidth).toBeCloseTo(38.6, 1);
      expect(alloc!.opBarWidth).toBeCloseTo(31.6, 1);
      expect(alloc!.shortfallBarWidth).toBeCloseTo(29.8, 1);
      expect(alloc!.revenueMarkPct).toBeCloseTo(70.2, 1);
      expect(alloc!.dailyBarWidth + alloc!.opBarWidth + alloc!.shortfallBarWidth).toBeCloseTo(100, 1);
    });

    it("caps covered daily costs at revenue when daily costs alone exceed revenue", () => {
      const heavyDailyLoss: SerializedMonthTile = {
        month: "2026-06",
        status: "open",
        revenueSen: 10000, // RM 100
        dailyCostSen: 15000, // RM 150 -> exceeds revenue by RM 50
        grossSen: -5000,
        operatingSen: 20000, // RM 200 -> total outflow RM 350, shortfall RM 250
        netSen: -25000,
      };
      const alloc = computeRevenueAllocation(heavyDailyLoss);
      expect(alloc).not.toBeNull();
      expect(alloc!.isLoss).toBe(true);
      expect(alloc!.coveredDailySen).toBe(10000);
      expect(alloc!.coveredOpSen).toBe(0);
      expect(alloc!.opBarWidth).toBe(0);
      expect(alloc!.shortfallSen).toBe(25000);
      expect(alloc!.dailyBarWidth + alloc!.shortfallBarWidth).toBeCloseTo(100, 1);

      // Rendered legend must qualify the capped Daily Costs amount so it never contradicts the RM 150 ledger
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DashboardView, {
          tiles: [heavyDailyLoss],
          activeMonth: "2026-06",
          activeTile: heavyDailyLoss,
          trend: [],
          split: null,
          costByCategory: null,
        })
      );
      expect(html).toContain("日常开销（营业额内）");
      expect(html).toContain("本月总开支");
    });

    it("omits revenue-share percentages when revenue is zero on a loss month", () => {
      const zeroRevLoss: SerializedMonthTile = {
        month: "2026-07",
        status: "open",
        revenueSen: 0,
        dailyCostSen: 5000,
        grossSen: -5000,
        operatingSen: 30000,
        netSen: -35000,
      };
      const alloc = computeRevenueAllocation(zeroRevLoss);
      expect(alloc).not.toBeNull();
      expect(alloc!.isLoss).toBe(true);
      expect(alloc!.hasRevenue).toBe(false);
      expect(alloc!.dailyOfRevPct).toBeNull();
      expect(alloc!.opOfRevPct).toBeNull();
      expect(alloc!.shortfallBarWidth).toBe(100);
      expect(alloc!.revenueMarkPct).toBeNull();
    });
  });

  describe("DashboardView render reproducibility", () => {
    it("consecutive renders produce byte-identical markup with ranked Cost Categories and MoM delta", () => {
      const prevTile: SerializedMonthTile = {
        month: "2026-04",
        status: "closed",
        revenueSen: 80000,
        dailyCostSen: 30000,
        grossSen: 50000,
        operatingSen: 10000,
        netSen: 40000,
      };
      const activeTile: SerializedMonthTile = {
        month: "2026-05",
        status: "open",
        revenueSen: 100000,
        dailyCostSen: 40000,
        grossSen: 60000,
        operatingSen: 10000,
        netSen: 50000,
      };

      const mockProps = {
        tiles: [activeTile, prevTile],
        activeMonth: "2026-05",
        activeTile,
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
          restock: 20000,
          gas: 20000,
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

      expect(render1).toBe(render2);
      expect(render1).toContain("50%");
      expect(render1).toContain("2026-04");
      expect(render1).toContain("+RM 100.00");
    });

    it("renders 100% bar cleanly for a single-category cost month", () => {
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

      expect(html).toContain("100%");
      expect(html).toContain("RM 400.00");
    });
  });

  describe("headline net profit dynamic sizing and grouped formatting", () => {
    it("formats grouped MYR amounts and shrinks headline on long negative totals", () => {
      const longTile: SerializedMonthTile = {
        month: "2026-05",
        status: "open",
        revenueSen: 100568612,
        dailyCostSen: 50000000,
        grossSen: 50568612,
        operatingSen: 120000000,
        netSen: -69431388,
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

      expect(longHtml).toContain("RM 1,005,686.12");
      expect(longHtml).toContain("RM 500,000.00");
      expect(longHtml).toContain("RM 1,200,000.00");
      expect(longHtml).toContain("694,313");
      expect(longHtml).toContain("text-3xl sm:text-[42px]");
      expect(longHtml).toContain("text-finance-loss");

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

      expect(normalHtml).toContain("5,000");
      expect(normalHtml).toContain("text-4xl sm:text-[42px]");
      expect(normalHtml).toContain("text-finance-profit");
    });
  });

  describe("daily trend metric tabs", () => {
    const row = { date: "2026-05-01", cashSen: 2000, tngSen: 3000, totalSen: 5000, costSen: 1500 };

    it("trendValueSen reads revenue from totalSen and Daily Cost from costSen", () => {
      expect(trendValueSen(row, "revenue")).toBe(5000);
      expect(trendValueSen(row, "cost")).toBe(1500);
    });

    it("renders Chrome-style browser tabs with revenue selected by default and animate-chart-swap", () => {
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

      expect(html).toContain('role="tablist"');
      expect(html).toContain('role="tabpanel"');
      expect(html).toMatch(/<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*tabindex="0"[^>]*>.*?每日收入趋势<\/span><\/button>/);
      expect(html).toMatch(/<button[^>]*role="tab"[^>]*aria-selected="false"[^>]*tabindex="-1"[^>]*>.*?每日开销趋势<\/span><\/button>/);
      expect(html).toContain("animate-chart-swap");
    });
  });
});
