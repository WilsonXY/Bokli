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
  ExpensesView,
  formatDeleteModalRecordCount,
  mergeOperatingExpenses,
  type OperatingExpenseItem,
} from "./ExpensesView";

describe("ExpensesView frontend review fixes", () => {
  describe("mergeOperatingExpenses & formatDeleteModalRecordCount", () => {
    it("groups duplicate items and aggregates ids and amounts", () => {
      const items: OperatingExpenseItem[] = [
        {
          id: 101,
          month: "2026-05",
          type: "rental",
          amountSen: 5000,
          note: "Main Stall",
          createdAt: "2026-05-01 10:00:00",
        },
        {
          id: 102,
          month: "2026-05",
          type: "rental",
          amountSen: 3000,
          note: "Main Stall",
          createdAt: "2026-05-02 10:00:00",
        },
        {
          id: 103,
          month: "2026-05",
          type: "rental",
          amountSen: 2000,
          note: "Main Stall",
          createdAt: "2026-05-03 10:00:00",
        },
        {
          id: 104,
          month: "2026-05",
          type: "utilities",
          amountSen: 1500,
          note: "Water",
          createdAt: "2026-05-01 10:00:00",
        },
      ];

      const merged = mergeOperatingExpenses(items);
      expect(merged).toHaveLength(2);

      const rentalMerged = merged.find((m) => m.type === "rental");
      expect(rentalMerged).toBeDefined();
      expect(rentalMerged?.ids).toEqual([101, 102, 103]);
      expect(rentalMerged?.amountSen).toBe(10000);

      const utilsMerged = merged.find((m) => m.type === "utilities");
      expect(utilsMerged).toBeDefined();
      expect(utilsMerged?.ids).toEqual([104]);
      expect(utilsMerged?.amountSen).toBe(1500);
    });

    it("formats delete modal record count correctly for single and plural counts", () => {
      expect(formatDeleteModalRecordCount(1)).toBe("removes 1 record");
      expect(formatDeleteModalRecordCount(2)).toBe("removes 2 records");
      expect(formatDeleteModalRecordCount(3)).toBe("removes 3 records");
      expect(formatDeleteModalRecordCount(5)).toBe("removes 5 records");
    });
  });

  describe("Delete confirmation modal record count rendering", () => {
    it("renders record count in modal copy matching ids.length for merged items", () => {
      const pendingDelete = {
        key: "rental_Main Stall_101",
        type: "rental" as const,
        note: "Main Stall",
        amountSen: 10000,
        ids: [101, 102, 103],
      };

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ExpensesView, {
          currentMonth: "2026-05",
          availableMonths: ["2026-05"],
          initialExpenses: [],
          summary: null,
          isClosed: false,
          initialPendingDeleteExpense: pendingDelete,
        }),
      );

      // Verify modal is rendered
      expect(html).toContain('role="dialog"');
      expect(html).toContain('id="confirm-delete-expense-desc"');

      // Verify the red record count prefix was removed from confirmation description
      expect(html).not.toContain("removes 3 records</span> — ");

      // Verify modal snapshot details show 3 records
      expect(html).toContain("removes 3 records");
      expect(html).toContain('data-testid="modal-record-count"');
      expect(html).toContain("Records:");
    });

    it("renders singular 'removes 1 record' when deleting a single-row item", () => {
      const pendingDelete = {
        key: "utilities_Water_201",
        type: "utilities" as const,
        note: "Water",
        amountSen: 2500,
        ids: [201],
      };

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ExpensesView, {
          currentMonth: "2026-05",
          availableMonths: ["2026-05"],
          initialExpenses: [],
          summary: null,
          isClosed: false,
          initialPendingDeleteExpense: pendingDelete,
        }),
      );

      expect(html).toContain("removes 1 record");
      expect(html).not.toContain("removes 1 records");
    });
  });
});
