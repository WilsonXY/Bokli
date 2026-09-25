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

import {
  MonthCloseView,
  computeReconciliationGating,
  submitMonthClose,
} from "./MonthCloseView";
import { DICTIONARY } from "@/lib/i18n";
import { tryParseSen } from "@/lib/money";

const t = DICTIONARY.zh;

const mockFinancials = {
  revenueSen: 100000,
  dailyCostSen: 40000,
  grossSen: 60000,
  operatingSen: 10000,
  netSen: 50000, // Expected Net = RM 500.00
};

describe("MonthCloseView variance-gating", () => {
  describe("variance != 0 requires note (blocks submit and requires explanation)", () => {
    it("pure gating: blocks close when variance is non-zero and note is empty", () => {
      const gating = computeReconciliationGating({
        cashInput: "600.00", // Counted RM 600.00 vs Expected RM 500.00 -> variance +RM 100.00
        tngInput: "0.00",
        expectedNetSen: 50000n,
        closeNote: "",
        hasSheetsInMonth: true,
        confirmEmpty: false,
      });

      expect(gating.isBalanced).toBe(false);
      expect(gating.varianceSen).toBe(10000n);
      expect(gating.canClose).toBe(false);
      expect(gating.validationError).toBe("varianceNoteRequired");
    });

    it("pure gating: allows close when variance is non-zero but valid note is provided", () => {
      const gating = computeReconciliationGating({
        cashInput: "450.00", // Counted RM 450.00 vs Expected RM 500.00 -> variance -RM 50.00
        tngInput: "0.00",
        expectedNetSen: 50000n,
        closeNote: "Shortage due to till cash float correction",
        hasSheetsInMonth: true,
        confirmEmpty: false,
      });

      expect(gating.isBalanced).toBe(false);
      expect(gating.varianceSen).toBe(-5000n);
      expect(gating.canClose).toBe(true);
      expect(gating.validationError).toBeNull();
    });

    it("renders required badge and mismatch indicator in markup when variance != 0 without note", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MonthCloseView, {
          currentMonth: "2026-05",
          availableMonths: ["2026-05"],
          financials: mockFinancials,
          hasSheetsInMonth: true,
          initialCashOnHandInput: "600.00",
          initialTngOnHandInput: "0.00",
          initialCloseNote: "",
          initialErrorMessage: t.varianceNoteRequired,
        })
      );

      // Verify mismatch indicator is displayed
      expect(html).toContain(t.reconciliationMismatch);

      // Verify close note label marks note as required
      expect(html).toContain(t.noteRequiredBadge);

      // Verify contextual error banner is rendered
      expect(html).toContain(t.varianceNoteRequired);
    });
  });

  describe("variance == 0 allows close", () => {
    it("pure gating: allows close when variance is zero without requiring note", () => {
      const gating = computeReconciliationGating({
        cashInput: "300.00",
        tngInput: "200.00",
        expectedNetSen: 50000n, // Counted RM 500.00 vs Expected RM 500.00 -> variance = 0
        closeNote: "",
        hasSheetsInMonth: true,
        confirmEmpty: false,
      });

      expect(gating.isBalanced).toBe(true);
      expect(gating.varianceSen).toBe(0n);
      expect(gating.canClose).toBe(true);
      expect(gating.validationError).toBeNull();
    });

    it("renders balanced badge and marks note as optional in markup when variance == 0", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MonthCloseView, {
          currentMonth: "2026-05",
          availableMonths: ["2026-05"],
          financials: mockFinancials,
          hasSheetsInMonth: true,
          initialCashOnHandInput: "300.00",
          initialTngOnHandInput: "200.00",
          initialCloseNote: "",
        })
      );

      // Verify balanced indicator is rendered
      expect(html).toContain(t.reconciliationBalanced);

      // Note label should NOT mark note as required
      expect(html).not.toContain(`(${t.noteRequiredBadge})`);

      // Placeholder should indicate optional
      expect(html).toContain(t.closeNoteOptional);
    });
  });

  describe("invalid (unparseable) cash input shows inline error and blocks submit rather than counting RM0", () => {
    it("pure gating: invalid cash string returns null rather than 0n, blocks close with invalidAmount error", () => {
      expect(tryParseSen("abc")).toBeNull();
      expect(tryParseSen("12.34.56")).toBeNull();
      expect(tryParseSen("--50")).toBeNull();
      expect(tryParseSen("invalid-input")).toBeNull();

      const gating = computeReconciliationGating({
        cashInput: "invalid-cash",
        tngInput: "100.00",
        expectedNetSen: 50000n,
        closeNote: "",
        hasSheetsInMonth: true,
        confirmEmpty: false,
      });

      expect(gating.cashError).toBe(true);
      expect(gating.hasParseError).toBe(true);
      expect(gating.cashOnHandSen).toBeNull();

      // Must NOT count as 0n (counting as RM 0 would yield false actual total of RM 100.00)
      expect(gating.actualCountedSen).toBeNull();
      expect(gating.varianceSen).toBeNull();

      expect(gating.canClose).toBe(false);
      expect(gating.validationError).toBe("invalidAmount");
    });

    it("renders inline error message, error border, and dash preview rather than RM 0.00 in markup", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MonthCloseView, {
          currentMonth: "2026-05",
          availableMonths: ["2026-05"],
          financials: mockFinancials,
          hasSheetsInMonth: true,
          initialCashOnHandInput: "abc",
          initialTngOnHandInput: "0.00",
        })
      );

      // Verify inline error under cash input is rendered
      expect(html).toContain(t.invalidAmount);

      // Verify error border styling is applied to the cash input
      expect(html).toContain("border-finance-loss");

      // Verify counted total displays "—" dash rather than counting unparseable input as RM 0.00
      expect(html).toContain("—");
      expect(html).not.toContain("RM0.00");
    });
  });

  describe("Chinese UI label verification for month close", () => {
    it("renders updated labels for 现金实际余额, Touch 'n Go 实际余额, and 实际总金额", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MonthCloseView, {
          currentMonth: "2026-05",
          availableMonths: ["2026-05"],
          financials: mockFinancials,
          hasSheetsInMonth: true,
          initialCashOnHandInput: "300.00",
          initialTngOnHandInput: "200.00",
          initialCloseNote: "",
        })
      );

      // P1: 现金实际余额
      expect(html).toContain("现金实际余额");
      expect(html).not.toContain("实际现金盘点");

      // P2: Touch 'n Go 实际余额 (handle HTML entity escaping)
      expect(html).toContain("Touch &#x27;n Go 实际余额");
      expect(html).not.toContain("Touch &#x27;n Go 期末余额");

      // P3: 实际总金额
      expect(html).toContain("实际总金额");
      expect(html).not.toContain("实点总金额");
    });
  });
});

describe("submitMonthClose (Month Close submit handler)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(overrides: {
    cashInput: string;
    tngInput: string;
    closeNote?: string;
    hasSheetsInMonth?: boolean;
    confirmEmpty?: boolean;
    submitting?: boolean;
    response?: { ok: boolean; body: unknown };
  }) {
    const closeNote = overrides.closeNote ?? "";
    const confirmEmpty = overrides.confirmEmpty ?? false;
    const gating = computeReconciliationGating({
      cashInput: overrides.cashInput,
      tngInput: overrides.tngInput,
      expectedNetSen: BigInt(mockFinancials.netSen),
      closeNote,
      hasSheetsInMonth: overrides.hasSheetsInMonth ?? true,
      confirmEmpty,
    });
    const response = overrides.response ?? { ok: true, body: { success: true } };
    const fetchImpl = vi.fn(async () => ({
      ok: response.ok,
      json: async () => response.body,
    })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    const deps = {
      submitting: overrides.submitting ?? false,
      gating,
      currentMonth: "2026-05",
      closeNote,
      confirmEmpty,
      t,
      setErrorMessage: vi.fn(),
      setSubmitting: vi.fn(),
      setSuccessMessage: vi.fn(),
      onClosed: vi.fn(),
      fetchImpl,
    };
    return deps;
  }

  function expectBlocked(deps: ReturnType<typeof setup>, message: string) {
    expect(deps.fetchImpl).not.toHaveBeenCalled();
    expect(deps.setSubmitting).not.toHaveBeenCalled();
    expect(deps.onClosed).not.toHaveBeenCalled();
    expect(deps.setErrorMessage).toHaveBeenNthCalledWith(1, null);
    expect(deps.setErrorMessage).toHaveBeenLastCalledWith(message);
  }

  it("blocks submit with invalidAmount when an amount is unparseable", async () => {
    const deps = setup({ cashInput: "abc", tngInput: "0.00" });
    await submitMonthClose(deps);
    expectBlocked(deps, t.invalidAmount);
  });

  it("invalidAmount takes priority over empty-month and missing-note errors", async () => {
    const deps = setup({
      cashInput: "12.34.56",
      tngInput: "0.00",
      hasSheetsInMonth: false,
      confirmEmpty: false,
      closeNote: "",
    });
    await submitMonthClose(deps);
    expectBlocked(deps, t.invalidAmount);
  });

  it("blocks submit with emptyMonthError for an empty month without confirmation", async () => {
    const deps = setup({
      cashInput: "600.00",
      tngInput: "0.00",
      hasSheetsInMonth: false,
      confirmEmpty: false,
      closeNote: "",
    });
    await submitMonthClose(deps);
    // Empty-month confirmation outranks the missing variance note.
    expectBlocked(deps, t.emptyMonthError);
  });

  it("blocks submit with varianceNoteRequired for a mismatched Reconciliation without a note", async () => {
    const deps = setup({ cashInput: "600.00", tngInput: "0.00", closeNote: "   " });
    await submitMonthClose(deps);
    expectBlocked(deps, t.varianceNoteRequired);
  });

  it("does nothing while a submission is already in flight", async () => {
    const deps = setup({ cashInput: "300.00", tngInput: "200.00", submitting: true });
    await submitMonthClose(deps);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
    expect(deps.setErrorMessage).not.toHaveBeenCalled();
    expect(deps.setSubmitting).not.toHaveBeenCalled();
  });

  it("submits a balanced Reconciliation with parsed amounts from gating", async () => {
    const deps = setup({ cashInput: "300.00", tngInput: "200.00" });
    await submitMonthClose(deps);

    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (deps.fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/close");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      month: "2026-05",
      cashOnHandSen: 30000,
      tngOnHandSen: 20000,
      confirmEmpty: false,
    });
    expect(deps.setSubmitting.mock.calls).toEqual([[true], [false]]);
    expect(deps.setErrorMessage.mock.calls).toEqual([[null]]);
    expect(deps.setSuccessMessage).toHaveBeenCalledWith(t.closeSuccess);
    expect(deps.onClosed).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3500);
    expect(deps.setSuccessMessage).toHaveBeenLastCalledWith(null);
  });

  it("submits a mismatched Reconciliation with a trimmed note and empty-month confirmation", async () => {
    const deps = setup({
      cashInput: "450.00",
      tngInput: "0.00",
      closeNote: "  Till float correction  ",
      hasSheetsInMonth: false,
      confirmEmpty: true,
    });
    await submitMonthClose(deps);

    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = (deps.fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      month: "2026-05",
      cashOnHandSen: 45000,
      tngOnHandSen: 0,
      note: "Till float correction",
      confirmEmpty: true,
    });
    expect(deps.onClosed).toHaveBeenCalledTimes(1);
  });

  it("surfaces a translated server error and resets submitting", async () => {
    const deps = setup({
      cashInput: "300.00",
      tngInput: "200.00",
      response: { ok: false, body: { error: "Unauthorized" } },
    });
    await submitMonthClose(deps);

    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    expect(deps.setErrorMessage).toHaveBeenLastCalledWith(t.unauthorizedError);
    expect(deps.setSuccessMessage).not.toHaveBeenCalled();
    expect(deps.onClosed).not.toHaveBeenCalled();
    expect(deps.setSubmitting.mock.calls).toEqual([[true], [false]]);
  });
});
