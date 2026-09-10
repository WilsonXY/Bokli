import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "@/db/migrate";

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

import HomePage from "../../app/page";
import MonthClosePage from "../../app/close/page";
import ExpensesPage from "../../app/expenses/page";
import DashboardPage from "../../app/dashboard/page";
import * as opexService from "@/services/operating-expense";
import * as dashboardService from "@/services/dashboard";
import * as monthCloseService from "@/services/month-close";
import { getTodayInKualaLumpur } from "@/services/daily-sheet";

describe("Server page error handling regression tests", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let tmpDir: string;
  let originalDbPath: string | undefined;

  beforeAll(() => {
    originalDbPath = process.env.BOKLI_DB_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-page-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    process.env.BOKLI_DB_PATH = dbPath;
    runMigrations(dbPath);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalDbPath) {
      process.env.BOKLI_DB_PATH = originalDbPath;
    } else {
      delete process.env.BOKLI_DB_PATH;
    }
  });

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("HomePage (/)", () => {
    it("falls back to today in KL when given an invalid date (e.g. 2026-02-30) without throwing 500", async () => {
      const todayKl = getTodayInKualaLumpur();
      const pageElement = await HomePage({
        searchParams: Promise.resolve({ date: "2026-02-30" }),
      });
      const html = ReactDOMServer.renderToStaticMarkup(pageElement);
      expect(html).toContain(todayKl);
    });

    it("falls back to today in KL when given a future date (e.g. 2099-01-01)", async () => {
      const todayKl = getTodayInKualaLumpur();
      const pageElement = await HomePage({
        searchParams: Promise.resolve({ date: "2099-01-01" }),
      });
      const html = ReactDOMServer.renderToStaticMarkup(pageElement);
      expect(html).toContain(todayKl);
    });

    it("falls back to today in KL when given a malformed date string", async () => {
      const todayKl = getTodayInKualaLumpur();
      const pageElement = await HomePage({
        searchParams: Promise.resolve({ date: "not-a-date" }),
      });
      const html = ReactDOMServer.renderToStaticMarkup(pageElement);
      expect(html).toContain(todayKl);
    });
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

    it("rejects malformed month like 2026-13 and falls back without throwing", async () => {
      const pageElement = await MonthClosePage({
        searchParams: Promise.resolve({ month: "2026-13" }),
      });
      const html = ReactDOMServer.renderToStaticMarkup(pageElement);
      expect(html).not.toContain("2026-13");
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

    it("filters out future months in DB from month dropdown options", async () => {
      vi.mocked(dashboardService.listMonthTiles).mockResolvedValueOnce([
        {
          month: "2099-01",
          revenueSen: 0n,
          dailyCostSen: 0n,
          grossSen: 0n,
          operatingSen: 0n,
          netSen: 0n,
          status: "open",
          balanced: false,
        },
        {
          month: "2026-08",
          revenueSen: 0n,
          dailyCostSen: 0n,
          grossSen: 0n,
          operatingSen: 0n,
          netSen: 0n,
          status: "open",
          balanced: false,
        },
      ]);

      const pageElement = await ExpensesPage({
        searchParams: Promise.resolve({ month: "2026-08" }),
      });
      const html = ReactDOMServer.renderToStaticMarkup(pageElement);
      expect(html).not.toContain("2099-01");
      expect(html).toContain("2026-08");
    });

    it("rejects malformed month like 2026-13 and falls back to valid month without error", async () => {
      const pageElement = await ExpensesPage({
        searchParams: Promise.resolve({ month: "2026-13" }),
      });
      const html = ReactDOMServer.renderToStaticMarkup(pageElement);
      expect(html).not.toContain("2026-13");
      expect(consoleErrorSpy).not.toHaveBeenCalled();
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

    it("filters out future months in DB from dashboard tiles", async () => {
      vi.mocked(dashboardService.listMonthTiles).mockResolvedValueOnce([
        {
          month: "2099-01",
          revenueSen: 0n,
          dailyCostSen: 0n,
          grossSen: 0n,
          operatingSen: 0n,
          netSen: 0n,
          status: "open",
          balanced: false,
        },
        {
          month: "2026-08",
          revenueSen: 0n,
          dailyCostSen: 0n,
          grossSen: 0n,
          operatingSen: 0n,
          netSen: 0n,
          status: "open",
          balanced: false,
        },
      ]);

      const pageElement = await DashboardPage({
        searchParams: Promise.resolve({ month: "2026-08" }),
      });
      const html = ReactDOMServer.renderToStaticMarkup(pageElement);
      expect(html).not.toContain("2099-01");
      expect(html).toContain("2026-08");
    });

    it("rejects malformed month like 2026-13 and falls back to valid month without error", async () => {
      const pageElement = await DashboardPage({
        searchParams: Promise.resolve({ month: "2026-13" }),
      });
      const html = ReactDOMServer.renderToStaticMarkup(pageElement);
      expect(html).not.toContain("2026-13");
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });
});
