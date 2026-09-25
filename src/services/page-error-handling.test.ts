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

// Mock the db module so getDb() acquisition itself can be forced to fail
vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return {
    ...actual,
    getDb: vi.fn(actual.getDb),
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
import * as dbModule from "@/db";
import { getTodayInKualaLumpur } from "@/lib/datetime";

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

  // Regression: getDb() used to be called outside these pages' try blocks, so an
  // unreachable DB threw on acquisition before loadError could be set and Next
  // rendered the generic error boundary instead of the page's own error UI.
  describe("DB handle acquisition failure (getDb throws)", () => {
    const actualGetDb = vi.mocked(dbModule.getDb).getMockImplementation()!;

    function breakDbAcquisition() {
      vi.mocked(dbModule.getDb).mockImplementation(() => {
        throw new Error("SQLITE_CANTOPEN: unable to open database file");
      });
    }

    afterEach(() => {
      vi.mocked(dbModule.getDb).mockImplementation(actualGetDb);
    });

    it("ExpensesPage renders its own error UI when the whole DB is unreachable", async () => {
      breakDbAcquisition();

      const pageElement = await ExpensesPage({
        searchParams: Promise.resolve({ month: "2026-08" }),
      });
      const html = ReactDOMServer.renderToStaticMarkup(pageElement);

      expect(html).toContain('role="alert"');
      expect(html).toContain("Failed to load expenses data");
      expect(html).not.toContain("Add Operating Expense");
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("MonthClosePage renders its own error UI when the whole DB is unreachable", async () => {
      breakDbAcquisition();

      const pageElement = await MonthClosePage({
        searchParams: Promise.resolve({ month: "2026-08" }),
      });
      const html = ReactDOMServer.renderToStaticMarkup(pageElement);

      expect(html).toContain('role="alert"');
      expect(html).toContain("Failed to load month close data");
      expect(html).not.toContain("btnPerformClose");
      expect(html).not.toContain("Financial Impact");
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    // The cases above trip the first try (listMonthTiles acquires its own handle
    // internally), which sets loadError and short-circuits the guarded block.
    // These two let the service reads succeed so the page-level getDb() call is
    // the only thing that fails — the exact line this fix moved.
    it("ExpensesPage recovers when only the page-level getDb() fails", async () => {
      vi.mocked(dashboardService.listMonthTiles).mockResolvedValueOnce([
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
      breakDbAcquisition();

      const pageElement = await ExpensesPage({
        searchParams: Promise.resolve({ month: "2026-08" }),
      });
      const html = ReactDOMServer.renderToStaticMarkup(pageElement);

      expect(html).toContain('role="alert"');
      expect(html).toContain("Failed to load expenses data");
      expect(html).not.toContain("Add Operating Expense");

      // Logged by the guarded block's catch, not the month-tiles catch
      const loggedErrorArgs = consoleErrorSpy.mock.calls.flat().join(" ");
      expect(loggedErrorArgs).toContain("Failed to load expenses data for 2026-08");
    });

    it("MonthClosePage recovers when only the page-level getDb() fails", async () => {
      vi.mocked(dashboardService.listMonthTiles).mockResolvedValueOnce([
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
      breakDbAcquisition();

      const pageElement = await MonthClosePage({
        searchParams: Promise.resolve({ month: "2026-08" }),
      });
      const html = ReactDOMServer.renderToStaticMarkup(pageElement);

      expect(html).toContain('role="alert"');
      expect(html).toContain("Failed to load month data");
      expect(html).not.toContain("btnPerformClose");
      expect(html).not.toContain("Financial Impact");

      const loggedErrorArgs = consoleErrorSpy.mock.calls.flat().join(" ");
      expect(loggedErrorArgs).toContain("Failed to load month close data for 2026-08");
    });

    it("HomePage logs under its own scope tag and re-throws for the error boundary", async () => {
      breakDbAcquisition();

      // The daily sheet form has no loadError UI, and rendering it with zeroed
      // figures would fabricate numbers, so the page deliberately re-throws.
      await expect(
        HomePage({ searchParams: Promise.resolve({}) }),
      ).rejects.toThrow("SQLITE_CANTOPEN");

      const loggedErrorArgs = consoleErrorSpy.mock.calls.flat().join(" ");
      expect(loggedErrorArgs).toContain("Failed to load daily sheet data");
    });
  });
});
