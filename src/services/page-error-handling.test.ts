import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// Mock auth
vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "1", username: "katte", role: "Admin" },
  }),
}));

// Mock services to allow simulating service failures
vi.mock("@/services/operating-expense", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/operating-expense")>();
  return {
    ...actual,
    getMonthPreview: vi.fn(actual.getMonthPreview),
    listOperatingExpenses: vi.fn(actual.listOperatingExpenses),
  };
});

vi.mock("@/services/dashboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/dashboard")>();
  return {
    ...actual,
    listMonthTiles: vi.fn(actual.listMonthTiles),
    getMonthTile: vi.fn(actual.getMonthTile),
  };
});

vi.mock("@/services/month-close", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/month-close")>();
  return {
    ...actual,
    getClose: vi.fn(actual.getClose),
  };
});

import MonthClosePage from "../../app/close/page";
import ExpensesPage from "../../app/expenses/page";
import DashboardPage from "../../app/dashboard/page";
import * as opexService from "@/services/operating-expense";
import * as dashboardService from "@/services/dashboard";
import * as monthCloseService from "@/services/month-close";

describe("Server page error handling regression tests", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("MonthClosePage (/close)", () => {
    it("forcing service throw yields visible error UI and blocks close flow, not zeros", async () => {
      // Force getMonthPreview to throw a DB / service error
      vi.mocked(opexService.getMonthPreview).mockRejectedValueOnce(
        new Error("Database connection timeout"),
      );

      const pageElement = await MonthClosePage({
        searchParams: Promise.resolve({ month: "2026-08" }),
      });

      const html = ReactDOMServer.renderToStaticMarkup(pageElement);

      // 1. Error was logged
      expect(consoleErrorSpy).toHaveBeenCalled();
      const loggedErrorArgs = consoleErrorSpy.mock.calls.flat().join(" ");
      expect(loggedErrorArgs).toContain("Failed to load month close data");

      // 2. Visible error alert banner is rendered
      expect(html).toContain('role="alert"');
      expect(html).toContain("Failed to load month data");

      // 3. Must NOT render fabricated zero figures or confirm empty month close flow
      expect(html).not.toContain("confirmEmptyMonth");
      expect(html).not.toContain("btnPerformClose");
      expect(html).not.toContain("Financial Impact");
      expect(html).not.toContain("0.00");
    });

    it("forcing listMonthTiles throw yields visible error UI and logs error", async () => {
      vi.mocked(dashboardService.listMonthTiles).mockRejectedValueOnce(
        new Error("Disk I/O error"),
      );

      const pageElement = await MonthClosePage({
        searchParams: Promise.resolve({ month: "2026-08" }),
      });

      const html = ReactDOMServer.renderToStaticMarkup(pageElement);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(html).toContain('role="alert"');
      expect(html).not.toContain("btnPerformClose");
    });
  });

  describe("ExpensesPage (/expenses)", () => {
    it("forcing service throw yields visible error UI, not zeros", async () => {
      vi.mocked(opexService.listOperatingExpenses).mockRejectedValueOnce(
        new Error("Table locked"),
      );

      const pageElement = await ExpensesPage({
        searchParams: Promise.resolve({ month: "2026-08" }),
      });

      const html = ReactDOMServer.renderToStaticMarkup(pageElement);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(html).toContain('role="alert"');
      expect(html).toContain("Failed to load expenses data");
      // Add form should be suppressed
      expect(html).not.toContain("Add Operating Expense");
    });
  });

  describe("DashboardPage (/dashboard)", () => {
    it("forcing service throw yields visible error UI, not zeros", async () => {
      vi.mocked(dashboardService.getMonthTile).mockRejectedValueOnce(
        new Error("Corrupted index"),
      );

      const pageElement = await DashboardPage({
        searchParams: Promise.resolve({ month: "2026-08" }),
      });

      const html = ReactDOMServer.renderToStaticMarkup(pageElement);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(html).toContain('role="alert"');
      expect(html).toContain("Failed to load dashboard data");
    });
  });
});
