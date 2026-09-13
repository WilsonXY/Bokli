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
  DailySheetForm,
  toSen,
  mergeCostLines,
  appendOrMergeCostLine,
  type CostLineItem,
} from "./DailySheetForm";
import { DICTIONARY } from "@/lib/i18n";

const t = DICTIONARY.zh;

describe("DailySheetForm parse error handling and toSen helper", () => {
  it("toSen helper returns bigint for valid inputs, 0n for empty, and null for invalid inputs", () => {
    expect(toSen("")).toBe(0n);
    expect(toSen("   ")).toBe(0n);
    expect(toSen("12.34")).toBe(1234n);
    expect(toSen("50")).toBe(5000n);
    expect(toSen("0.5")).toBe(50n);

    // Invalid inputs must return null, NOT 0n
    expect(toSen("12.")).toBeNull();
    expect(toSen("abc")).toBeNull();
    expect(toSen("12.34.56")).toBeNull();
    expect(toSen(".")).toBeNull();
  });

  it("renders inline error message, error border, and dash preview rather than RM 0.00 for invalid cash input", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 0,
        initialTngSen: 10000,
        initialCashInput: "12.",
        initialTngInput: "100.00",
        initialCostLines: [],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    // Verify inline error under cash input is rendered
    expect(html).toContain(t.invalidAmount);

    // Verify error border styling is applied to the cash input
    expect(html).toContain("border-finance-loss");

    // Verify revenue display shows "—" dash rather than counting unparseable input as RM 0.00
    expect(html).toContain("—");
    expect(html).not.toContain("RM100.00</span>");
  });

  it("renders inline error message and error border for invalid TnG input", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 0,
        initialCashInput: "50.00",
        initialTngInput: "invalid",
        initialCostLines: [],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    expect(html).toContain(t.invalidAmount);
    expect(html).toContain("border-finance-loss");
    expect(html).toContain("—");
  });

  it("renders updated Chinese labels for daily costs section: 日常开销, 开销总额, and 开销类别", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCashInput: "50.00",
        initialTngInput: "50.00",
        initialCostLines: [],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    // P1: 日常开销 without 明细
    expect(html).toContain("日常开销");
    expect(html).not.toContain("日常开销明细");

    // P2: 开销类别
    expect(html).toContain("开销类别");

    // P3: 开销总额
    expect(html).toContain("开销总额");
    expect(html).not.toContain("开销总计");
  });
});

describe("mergeCostLines helper for DailySheetForm", () => {
  it("passes through a single line without modification and without singular id", () => {
    const items: CostLineItem[] = [
      { id: 42, category: "gas", amountSen: 2500, note: "Shell" },
    ];
    const merged = mergeCostLines(items);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      category: "gas",
      amountSen: 2500,
      note: "Shell",
      ids: [42],
    });
    expect(merged[0].id).toBeUndefined();
  });

  it("is case-sensitive: 'Rice' and 'rice' must NOT merge", () => {
    const items: CostLineItem[] = [
      { id: 1, category: "restock", amountSen: 1000, note: "Rice" },
      { id: 2, category: "restock", amountSen: 2000, note: "rice" },
    ];
    const merged = mergeCostLines(items);
    expect(merged).toHaveLength(2);
    expect(merged[0].note).toBe("Rice");
    expect(merged[0].amountSen).toBe(1000);
    expect(merged[0].ids).toEqual([1]);
    expect(merged[1].note).toBe("rice");
    expect(merged[1].amountSen).toBe(2000);
    expect(merged[1].ids).toEqual([2]);
  });

  it("groups duplicate items and aggregates ids and amounts without singular id", () => {
    const items: CostLineItem[] = [
      {
        id: 101,
        category: "restock",
        amountSen: 5000,
        note: "Rice",
      },
      {
        id: 102,
        category: "restock",
        amountSen: 3000,
        note: "Rice",
      },
      {
        id: 103,
        category: "restock",
        amountSen: 2000,
        note: " Rice ",
      },
      {
        id: 104,
        category: "gas",
        amountSen: 1500,
        note: "Shell",
      },
    ];

    const merged = mergeCostLines(items);
    expect(merged).toHaveLength(2);

    const restockMerged = merged.find((m) => m.category === "restock");
    expect(restockMerged).toBeDefined();
    expect(restockMerged?.ids).toEqual([101, 102, 103]);
    expect(restockMerged?.amountSen).toBe(10000);
    expect(restockMerged?.note).toBe("Rice");
    expect(restockMerged?.id).toBeUndefined();

    const gasMerged = merged.find((m) => m.category === "gas");
    expect(gasMerged).toBeDefined();
    expect(gasMerged?.ids).toEqual([104]);
    expect(gasMerged?.amountSen).toBe(1500);
    expect(gasMerged?.note).toBe("Shell");
    expect(gasMerged?.id).toBeUndefined();
  });

  it("treats null, empty string, and whitespace-only notes as equivalent (no note)", () => {
    const items: CostLineItem[] = [
      { id: 1, category: "gas", amountSen: 1000, note: null },
      { id: 2, category: "gas", amountSen: 2000, note: "" },
      { id: 3, category: "gas", amountSen: 3000, note: "   " },
    ];

    const merged = mergeCostLines(items);
    expect(merged).toHaveLength(1);
    expect(merged[0].category).toBe("gas");
    expect(merged[0].ids).toEqual([1, 2, 3]);
    expect(merged[0].amountSen).toBe(6000);
    expect(merged[0].note).toBeNull();
  });

  it("handles newly added items without ids alongside existing items", () => {
    const items: CostLineItem[] = [
      { id: 101, ids: [101], category: "restock", amountSen: 5000, note: "Rice" },
      { category: "restock", amountSen: 2500, note: "Rice" },
    ];

    const merged = mergeCostLines(items);
    expect(merged).toHaveLength(1);
    expect(merged[0].ids).toEqual([101]);
    expect(merged[0].amountSen).toBe(7500);
  });

  it("appendOrMergeCostLine (handleAddCostLine path) merges matching line and preserves existing ids", () => {
    const existing: CostLineItem[] = [
      { category: "restock", amountSen: 5000, note: "Rice", ids: [101, 102] },
      { category: "gas", amountSen: 2000, note: "Shell", ids: [103] },
    ];

    // Adding new amount to restock + Rice
    const result = appendOrMergeCostLine(existing, "restock", 3000, "Rice");
    expect(result.error).toBeUndefined();
    expect(result.lines).toHaveLength(2);

    const restockLine = result.lines.find((l) => l.category === "restock");
    expect(restockLine).toBeDefined();
    expect(restockLine?.amountSen).toBe(8000);
    // Crucial: existing ids array [101, 102] is preserved!
    expect(restockLine?.ids).toEqual([101, 102]);

    // Adding brand new line gets ids: []
    const resultNew = appendOrMergeCostLine(result.lines, "other", 1500, "Boxes");
    expect(resultNew.lines).toHaveLength(3);
    const otherLine = resultNew.lines.find((l) => l.category === "other");
    expect(otherLine?.ids).toEqual([]);
  });

  it("delete-merged-row drops whole group of underlying records", () => {
    const mergedItems: CostLineItem[] = mergeCostLines([
      { id: 101, category: "restock", amountSen: 2000, note: "Rice" },
      { id: 102, category: "restock", amountSen: 3000, note: "Rice" },
      { id: 103, category: "gas", amountSen: 1500, note: "Shell" },
    ]);

    expect(mergedItems).toHaveLength(2);
    expect(mergedItems[0].ids).toEqual([101, 102]);

    // Deleting index 0 (the merged Rice line) drops both underlying IDs
    const afterDelete = mergedItems.filter((_, idx) => idx !== 0);
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0].category).toBe("gas");
    expect(afterDelete.some((l) => l.ids?.includes(101) || l.ids?.includes(102))).toBe(false);
  });

  it("guards runaway totals and safely handles non-string notes", () => {
    const runaway = Number.MAX_SAFE_INTEGER;
    const items: CostLineItem[] = [
      { id: 1, category: "restock", amountSen: runaway, note: 123 as unknown as string },
      { id: 2, category: "restock", amountSen: 1000, note: null },
    ];
    const merged = mergeCostLines(items);
    expect(merged).toHaveLength(1);
    expect(merged[0].amountSen).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("DailySheetForm renders duplicate initialCostLines as a single merged row (not false positive)", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: [
          { id: 1, category: "restock", amountSen: 2000, note: "Rice" },
          { id: 2, category: "restock", amountSen: 3000, note: "Rice" },
        ],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    // Rice note appears exactly once in the rendered markup
    const riceMatches = html.match(/>Rice<\/span>/g) || [];
    expect(riceMatches).toHaveLength(1);

    // Unmerged individual amounts (RM20.00, RM30.00) must NOT appear anywhere in the rendered markup
    expect(html).not.toContain("RM20.00");
    expect(html).not.toContain("RM30.00");

    // The merged line amount RM50.00 is rendered
    expect(html).toContain("RM50.00");

    // Exactly one delete button is rendered for the single merged row
    const deleteButtonMatches = html.match(new RegExp(`aria-label="${t.delete}"`, "g")) || [];
    expect(deleteButtonMatches).toHaveLength(1);
  });
});
