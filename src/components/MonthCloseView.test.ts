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
  MonthCloseView,
  computeReconciliationGating,
  parseMoneyInputSen,
} from "./MonthCloseView";
import { DICTIONARY } from "@/lib/i18n";

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
      expect(parseMoneyInputSen("abc")).toBeNull();
      expect(parseMoneyInputSen("12.34.56")).toBeNull();
      expect(parseMoneyInputSen("--50")).toBeNull();
      expect(parseMoneyInputSen("invalid-input")).toBeNull();

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
});
