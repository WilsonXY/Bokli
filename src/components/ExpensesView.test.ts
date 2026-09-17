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

  describe("Delete confirmation modal rendering", () => {
    it("renders clean confirmation modal without redundant records count row", () => {
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

      // Verify redundant record count is omitted from description and details table
      expect(html).not.toContain("removes 3 records</span> — ");
      expect(html).not.toContain('data-testid="modal-record-count"');
      expect(html).not.toContain("Records:");

      // Verify item snapshot details still show note and amount
      expect(html).toContain("Main Stall");
      expect(html).toContain("100.00");
    });

    it("renders simplified headers, 本月毛利润, and omits the total count badge from list header", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ExpensesView, {
          currentMonth: "2026-05",
          availableMonths: ["2026-05"],
          initialExpenses: [
            {
              id: 1,
              month: "2026-05",
              type: "rental",
              amountSen: 5000,
              note: "Main Stall",
              createdAt: "2026-05-01 10:00:00",
            },
          ],
          summary: {
            grossSen: 10500,
            operatingSen: 5000,
            netSen: 5500,
          },
          isClosed: false,
        }),
      );

      // P4: 固定支出 instead of 固定运营支出
      expect(html).toContain("固定支出");
      expect(html).not.toContain("固定运营支出");

      // P5: Removed counter/expenseTotal row from list header
      expect(html).not.toContain("固定支出总计");

      // P6: Financial impact card renders 本月毛利润 instead of 当日毛利润
      expect(html).toContain("本月毛利润");
      expect(html).not.toContain("当日毛利润");
    });
  });
  describe("Invalid amount error inline parity", () => {
    it("renders inline amount error under input without top banner when amountError is true", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ExpensesView, {
          currentMonth: "2026-05",
          availableMonths: ["2026-05"],
          initialExpenses: [],
          isClosed: false,
          initialIsDraftOpen: true,
          initialAmountError: true,
        }),
      );

      // Verify inline error under input is present with boxed styling
      expect(html).toContain("请输入有效金额");
      expect(html).toContain("bg-finance-loss-light");
      expect(html).toContain("border-finance-loss-border");

      // Verify top inlineError banner is NOT present
      expect(html).not.toContain("animate-slide-down");
      expect(html).not.toContain('aria-label="Close"');
    });

    it("renders top banner when inlineError is present (e.g. API error or other errors)", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ExpensesView, {
          currentMonth: "2026-05",
          availableMonths: ["2026-05"],
          initialExpenses: [],
          isClosed: false,
          initialIsDraftOpen: true,
          initialInlineError: "Network connection failed",
        }),
      );

      // Verify top banner is rendered
      expect(html).toContain("Network connection failed");
      expect(html).toContain('aria-label="Close"');
    });

    it("renders inline note-required error under note input with boxed styling and no top banner when other category has empty note", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ExpensesView, {
          currentMonth: "2026-05",
          availableMonths: ["2026-05"],
          initialExpenses: [],
          isClosed: false,
          initialIsDraftOpen: true,
          initialNewType: "other",
          initialNoteInput: "",
          initialNoteError: true,
        }),
      );

      // Verify inline error under note input is present with boxed styling
      expect(html).toContain('id="expense-note-error"');
      expect(html).toContain('role="alert"');
      expect(html).toContain("必须填写备注说明");
      expect(html).toContain("类别为&#x27;其他&#x27;时");
      expect(html).toContain("bg-finance-loss-light");
      expect(html).toContain("border-finance-loss-border");
      expect(html).toContain("rounded-lg");
      expect(html).toContain("text-finance-loss");
      expect(html).toContain("font-medium");

      // Verify note input has error border and accessibility attributes
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('aria-describedby="expense-note-error"');
      expect(html).toContain("border-finance-loss");

      // Verify top inlineError banner is NOT present
      expect(html).not.toContain("animate-slide-down");
      expect(html).not.toContain('aria-label="Close"');
    });
  });

  describe("long amount dynamic sizing", () => {
    it("applies dynamic shrink classes on long money amounts > 11 chars", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ExpensesView, {
          currentMonth: "2026-05",
          availableMonths: ["2026-05"],
          initialExpenses: [
            {
              id: 1,
              month: "2026-05",
              type: "rental",
              amountSen: 120000000, // RM1200000.00 -> 12 chars
              note: "Warehouse",
              createdAt: "2026-05-01 10:00:00",
            },
          ],
          summary: {
            grossSen: 100568612, // RM1005686.12 -> 12 chars
            operatingSen: 120000000, // RM1200000.00 -> 12 chars
            netSen: -19431388, // -RM194313.88 -> 13 chars
          },
          isClosed: false,
          initialPendingDeleteExpense: {
            key: "rental_Warehouse_1",
            type: "rental",
            note: "Warehouse",
            amountSen: 120000000,
            ids: [1],
          },
        }),
      );

      // Summary gross: RM1005686.12 (12 chars) -> replaces text-base with text-xs (no coexistence)
      expect(html).toContain("RM1005686.12");
      expect(html).toMatch(/class="[^"]*text-xs sm:text-xl font-bold text-ink-primary tabular-nums"[^>]*>RM1005686\.12/);
      expect(html).not.toMatch(/class="[^"]*text-base[^"]*"[^>]*>RM1005686\.12/);

      // Summary operating expenses: RM1200000.00 (12 chars) -> replaces text-base with text-xs (no coexistence)
      expect(html).toContain("RM1200000.00");
      expect(html).toMatch(/class="[^"]*text-xs sm:text-xl font-bold text-slate-700 tabular-nums"[^>]*>RM1200000\.00/);
      expect(html).not.toMatch(/class="[^"]*text-base[^"]*"[^>]*>RM1200000\.00/);

      // Summary net: -RM194313.88 (13 chars) -> text-xl instead of text-2xl
      expect(html).toContain("-RM194313.88");
      expect(html).toMatch(/class="[^"]*text-xl sm:text-3xl font-extrabold tracking-tight tabular-nums text-rose-600"[^>]*>-RM194313\.88/);
      expect(html).not.toMatch(/class="[^"]*text-2xl[^"]*"[^>]*>-RM194313\.88/);

      // Merged expense item: RM1200000.00 (12 chars) -> replaces text-base with text-xs (no coexistence)
      expect(html).toMatch(/class="[^"]*text-xs font-bold text-slate-700 tabular-nums whitespace-nowrap"[^>]*>RM1200000\.00/);
      expect(html).not.toMatch(/class="[^"]*text-base[^"]*"[^>]*>RM1200000\.00/);

      // Delete modal snapshot: RM1200000.00 (12 chars) -> replaces text-base with text-xs (no coexistence)
      expect(html).toMatch(/class="[^"]*text-xs font-bold text-finance-loss whitespace-nowrap tabular-nums"[^>]*>RM1200000\.00/);
      expect(html).not.toMatch(/class="[^"]*text-base[^"]*"[^>]*>RM1200000\.00/);
    });

    it("keeps standard base classes on money amounts <= 11 chars", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ExpensesView, {
          currentMonth: "2026-05",
          availableMonths: ["2026-05"],
          initialExpenses: [
            {
              id: 1,
              month: "2026-05",
              type: "rental",
              amountSen: 50000000, // RM500000.00 -> 11 chars
              note: "Main Stall",
              createdAt: "2026-05-01 10:00:00",
            },
          ],
          summary: {
            grossSen: 50000000, // RM500000.00 -> 11 chars
            operatingSen: 50000000, // RM500000.00 -> 11 chars
            netSen: 0, // RM0.00 -> 6 chars
          },
          isClosed: false,
        }),
      );

      // Summary gross: RM500000.00 (11 chars) -> keeps text-base sm:text-xl (no text-xs)
      expect(html).toMatch(/class="[^"]*text-base sm:text-xl font-bold text-ink-primary tabular-nums"[^>]*>RM500000\.00/);
      expect(html).not.toMatch(/class="[^"]*text-xs[^"]*"[^>]*>RM500000\.00/);

      // Summary operating: RM500000.00 (11 chars) -> keeps text-base sm:text-xl (no text-xs)
      expect(html).toMatch(/class="[^"]*text-base sm:text-xl font-bold text-slate-700 tabular-nums"[^>]*>RM500000\.00/);
      expect(html).not.toMatch(/class="[^"]*text-xs[^"]*"[^>]*>RM500000\.00/);

      // Summary net: RM0.00 (6 chars) -> text-2xl sm:text-3xl
      expect(html).toMatch(/class="[^"]*text-2xl sm:text-3xl font-extrabold tracking-tight tabular-nums text-emerald-700"[^>]*>RM0\.00/);
      expect(html).not.toMatch(/class="[^"]*text-xl[^"]*"[^>]*>RM0\.00/);

      // Merged expense item: RM500000.00 (11 chars) -> keeps text-base (no text-xs)
      expect(html).toMatch(/class="[^"]*text-base font-bold text-slate-700 tabular-nums whitespace-nowrap"[^>]*>RM500000\.00/);
      expect(html).not.toMatch(/class="[^"]*text-xs[^"]*"[^>]*>RM500000\.00/);
    });
  });
});
