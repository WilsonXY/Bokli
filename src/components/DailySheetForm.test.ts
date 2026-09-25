import { describe, it, expect, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { findMissingOtherNoteIndex } from "@/components/DailySheetForm";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import {
  DailySheetForm,
  mergeCostLines,
  consolidateCostLines,
  consolidateCostLinesForSave,
  tryConsolidateCostLines,
  findConsolidatedLineIndex,
  toggleCostLineExpansion,
  createNewCostLine,
  findZeroCostLineIndex,
  getCostLineKey,
  rebaseCostLinesAfterSave,
  type CostLineItem,
} from "./DailySheetForm";
import { DICTIONARY, translateApiError } from "@/lib/i18n";
import { CostLineAmountOverflowError } from "@/lib/cost-line-group";
import { tryParseSen } from "@/lib/money";

const t = DICTIONARY.zh;

describe("DailySheetForm parse error handling and tryParseSen helper", () => {
  it("tryParseSen helper returns bigint for valid inputs, 0n for empty, and null for invalid inputs", () => {
    expect(tryParseSen("")).toBe(0n);
    expect(tryParseSen("   ")).toBe(0n);
    expect(tryParseSen("12.34")).toBe(1234n);
    expect(tryParseSen("50")).toBe(5000n);
    expect(tryParseSen("0.5")).toBe(50n);

    // Invalid inputs must return null, NOT 0n
    expect(tryParseSen("12.")).toBeNull();
    expect(tryParseSen("abc")).toBeNull();
    expect(tryParseSen("12.34.56")).toBeNull();
    expect(tryParseSen(".")).toBeNull();
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

    // P2: 开销总额 without 今日
    expect(html).toContain("开销总额");
    expect(html).not.toContain("今日开销总额");

    // P3: 开销类别 instead of 支出类别
    expect(html).toContain("开销类别");
    expect(html).not.toContain("支出类别");
  });

  it("renders compact action bar and unboxed headers without card containers", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: [],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    // P4: Date navigation button uses clean inline title
    expect(html).toContain("点击打开/关闭日历 (Click to toggle calendar)");

    // P5: Check that Save Sheet button uses bold compact button
    expect(html).toContain(t.saveSheet);

    // P6: Sections have uppercase tracking headers
    expect(html).toContain("tracking-wider");
  });

  it("renders compact action bar on mobile viewport and flush revenue inputs", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 12500,
        initialTngSen: 8500,
        initialCostLines: [],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    // Check revenue section exists with inputs
    expect(html).toContain('id="cash-input"');
    expect(html).toContain('id="tng-input"');
    expect(html).toContain(t.cashRevenue);
    expect(html).toContain(t.tngRevenue.replace("'", "&#x27;"));

    // Check gross profit summary
    expect(html).toContain(t.grossProfit);
    expect(html).toContain("RM210.00");
  });
});

describe("mergeCostLines, getCostLineKey, and deletion logic", () => {
  it("getCostLineKey produces stable unique keys for lines by id, ids, clientId, and category+note", () => {
    expect(getCostLineKey({ id: 42, category: "restock", amountSen: 1000 })).toBe("cost-line-42");
    expect(getCostLineKey({ ids: [103, 101, 102], category: "gas", amountSen: 2000 })).toBe("cost-line-101-102-103");
    expect(getCostLineKey({ clientId: "client-abc-123", category: "transport", amountSen: 500 })).toBe("cost-line-client-abc-123");
    expect(getCostLineKey({ category: "maintenance", note: "Plumbing", amountSen: 1500 })).toBe("cost-line-maintenance-Plumbing");
    expect(getCostLineKey({ category: "other", amountSen: 0 }, 5)).toBe("cost-line-other-5");
  });

  it("groups duplicate items and aggregates ids and amounts", () => {
    const items: CostLineItem[] = [
      { id: 101, category: "restock", amountSen: 5000, note: "Rice" },
      { id: 102, category: "restock", amountSen: 3000, note: "Rice" },
      { id: 103, category: "restock", amountSen: 2000, note: "Rice" },
      { id: 104, category: "gas", amountSen: 1500, note: "Shell" },
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

  it("rejects runaway totals instead of clamping and safely handles non-string notes", () => {
    const runaway = Number.MAX_SAFE_INTEGER;
    const items: CostLineItem[] = [
      { id: 1, category: "restock", amountSen: runaway, note: 123 as unknown as string },
      { id: 2, category: "restock", amountSen: 1000, note: null },
    ];
    expect(() => mergeCostLines(items)).toThrow(CostLineAmountOverflowError);

    // A non-string note is treated as "no note" and still groups with null
    const merged = mergeCostLines([
      { id: 1, category: "restock", amountSen: 500, note: 123 as unknown as string },
      { id: 2, category: "restock", amountSen: 1000, note: null },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].note).toBeNull();
    expect(merged[0].amountSen).toBe(1500);
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

  it("cost-line stable keys and controlled values: deleting middle line keeps values attached to correct lines and reload/revert refreshes input values", () => {
    // 3 initial lines
    const lineA: CostLineItem = { id: 10, category: "restock", amountSen: 1000, note: "Rice" };
    const lineB: CostLineItem = { id: 20, category: "gas", amountSen: 2500, note: "Shell" };
    const lineC: CostLineItem = { id: 30, category: "maintenance", amountSen: 4000, note: "Stove" };

    const initialMerged = mergeCostLines([lineA, lineB, lineC]);
    expect(initialMerged).toHaveLength(3);

    // Verify stable keys
    const keyA = getCostLineKey(initialMerged[0], 0);
    const keyB = getCostLineKey(initialMerged[1], 1);
    const keyC = getCostLineKey(initialMerged[2], 2);

    expect(keyA).toBe("cost-line-10");
    expect(keyB).toBe("cost-line-20");
    expect(keyC).toBe("cost-line-30");

    // Controlled input values are correctly populated from mergeCostLines
    expect(initialMerged[0].amountInput).toBe("10");
    expect(initialMerged[1].amountInput).toBe("25");
    expect(initialMerged[2].amountInput).toBe("40");

    // Deleting middle line (index 1) leaves line 0 and line 2
    const afterDelete = initialMerged.filter((_, idx) => idx !== 1);
    expect(afterDelete).toHaveLength(2);

    // After deleting middle line, line 0 remains lineA with key "cost-line-10" and amount "10",
    // and line 1 is now lineC with key "cost-line-30" and amount "40" (NOT polluted by lineB!)
    expect(getCostLineKey(afterDelete[0], 0)).toBe("cost-line-10");
    expect(afterDelete[0].note).toBe("Rice");
    expect(afterDelete[0].amountSen).toBe(1000);
    expect(afterDelete[0].amountInput).toBe("10");

    expect(getCostLineKey(afterDelete[1], 1)).toBe("cost-line-30");
    expect(afterDelete[1].note).toBe("Stove");
    expect(afterDelete[1].amountSen).toBe(4000);
    expect(afterDelete[1].amountInput).toBe("40");

    // Verify rendered markup with 3 lines renders each row with stable keys and correct values
    const html3 = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: [lineA, lineB, lineC],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );
    expect(html3).toContain("Rice");
    expect(html3).toContain("RM10.00");
    expect(html3).toContain("Shell");
    expect(html3).toContain("RM25.00");
    expect(html3).toContain("Stove");
    expect(html3).toContain("RM40.00");

    // When a single row is rendered or an item is expanded, its inputs are controlled
    const htmlSingle = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: [lineA],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );
    expect(htmlSingle).toContain('value="10"');
    expect(htmlSingle).toContain('value="Rice"');

    // Render with lineB deleted (only lineA and lineC)
    const html2 = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: [lineA, lineC],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );
    expect(html2).toContain("Rice");
    expect(html2).toContain("RM10.00");
    expect(html2).toContain("Stove");
    expect(html2).toContain("RM40.00");
    expect(html2).not.toContain("Shell");
    expect(html2).not.toContain("RM25.00");

    // Reverting/reloading data refreshes the input values back to baseline
    const reloaded = mergeCostLines([lineA, lineB, lineC]);
    expect(reloaded[0].amountInput).toBe("10");
    expect(reloaded[0].note).toBe("Rice");
    expect(reloaded[1].amountInput).toBe("25");
    expect(reloaded[1].note).toBe("Shell");
    expect(reloaded[2].amountInput).toBe("40");
    expect(reloaded[2].note).toBe("Stove");
  });
});

describe("findMissingOtherNoteIndex (save gate)", () => {
  const zh = DICTIONARY.zh;

  it("returns the index of the first other-category line missing a note", () => {
    const lines = [
      { category: "restock" as const, note: "" },
      { category: "other" as const, note: "   " },
      { category: "other" as const, note: "" },
    ];
    expect(findMissingOtherNoteIndex(lines)).toBe(1);
  });

  it("returns -1 when every other-category line has a note (trimmed counts)", () => {
    const lines = [
      { category: "other" as const, note: " Petrol " },
      { category: "restock" as const, note: "" },
    ];
    expect(findMissingOtherNoteIndex(lines)).toBe(-1);
  });

  it("returns -1 for non-other lines with empty notes", () => {
    const lines = [{ category: "restock" as const, note: "" }];
    expect(findMissingOtherNoteIndex(lines)).toBe(-1);
  });

  it("translateApiError maps the daily-sheet other-note 400 to otherNoteRequired, not varianceNoteRequired", () => {
    const err =
      "Note is required when Cost Category is 'other'";
    expect(translateApiError(err, zh)).toBe(zh.otherNoteRequired);
    expect(translateApiError(err, zh)).not.toBe(zh.varianceNoteRequired);
  });

  it("translateApiError keeps month-close variance messages on varianceNoteRequired", () => {
    const err = "Variance detected. A note is required.";
    expect(translateApiError(err, zh)).toBe(zh.varianceNoteRequired);
  });
});

describe("cost line consolidation on add/save only (consolidateCostLines)", () => {
  // (a) typing an amount on a fresh line that matches an existing line does NOT merge
  it("typing an amount on a fresh line that matches an existing line does NOT merge", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 4000, amountInput: "40", note: "Rice" },
      { clientId: "line-2", category: "restock", amountSen: 0, amountInput: "", note: "Rice" },
    ];

    // User types "10" on line-2 (plain functional patch, no live merge mid-typing)
    const updated = lines.map((l, i) =>
      i === 1 ? { ...l, amountSen: 1000, amountInput: "10" } : l
    );

    expect(updated).toHaveLength(2);
    expect(updated[0].amountSen).toBe(4000);
    expect(updated[1].amountSen).toBe(1000);

    // Merging only happens when consolidateCostLines is explicitly called (on add or save)
    const consolidated = consolidateCostLines(updated);
    expect(consolidated).toHaveLength(1);
    expect(consolidated[0].amountSen).toBe(5000);
    expect(consolidated[0].amountInput).toBe("50");
  });

  // (b) consolidateCostLines merges two >0 duplicates and sums
  it("consolidateCostLines merges two >0 duplicates and sums", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 2000, amountInput: "20", note: "Rice" },
      { clientId: "line-2", category: "restock", amountSen: 3000, amountInput: "30", note: "Rice" },
    ];

    const result = consolidateCostLines(lines);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("restock");
    expect(result[0].note).toBe("Rice");
    expect(result[0].amountSen).toBe(5000);
    expect(result[0].amountInput).toBe("50");
    expect(result[0].clientId).toBe("line-1");
  });

  it("merges duplicates with matching category and whitespace-equivalent note", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 2000, amountInput: "20", note: "Rice" },
      { clientId: "line-2", category: "restock", amountSen: 3000, amountInput: "30", note: "  Rice  " },
    ];

    const result = consolidateCostLines(lines);

    expect(result).toHaveLength(1);
    expect(result[0].note).toBe("Rice");
    expect(result[0].amountSen).toBe(5000);
  });

  it("throws on merged overflow instead of capping at MAX_SAFE_INTEGER", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: Number.MAX_SAFE_INTEGER, note: "Rice" },
      { clientId: "line-2", category: "restock", amountSen: 1000, note: "Rice" },
    ];

    expect(() => consolidateCostLines(lines)).toThrow(CostLineAmountOverflowError);
    // Input draft is not mutated
    expect(lines[0].amountSen).toBe(Number.MAX_SAFE_INTEGER);
    expect(lines[1].amountSen).toBe(1000);
  });

  // (c) zero lines pass through untouched and keep position
  it("zero lines pass through untouched and keep position", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 2000, note: "" },
      { clientId: "line-2", category: "restock", amountSen: 0, note: "" },
      { clientId: "line-3", category: "restock", amountSen: 3000, note: "" },
    ];

    const result = consolidateCostLines(lines);

    expect(result).toHaveLength(2);
    expect(result[0].clientId).toBe("line-1");
    expect(result[0].amountSen).toBe(5000);
    expect(result[1]).toBe(lines[1]);
    expect(result[1].amountSen).toBe(0);

    // Two zero-amount lines also pass through untouched without merging
    const twoZeroLines: CostLineItem[] = [
      { clientId: "line-a", category: "restock", amountSen: 0, note: "Rice" },
      { clientId: "line-b", category: "restock", amountSen: 0, note: "Rice" },
    ];
    const resZero = consolidateCostLines(twoZeroLines);
    expect(resZero).toHaveLength(2);
    expect(resZero[0]).toBe(twoZeroLines[0]);
    expect(resZero[1]).toBe(twoZeroLines[1]);
  });

  // (d) ids combine, first position kept
  it("combines ids and keeps the first line position and clientId", () => {
    const lines: CostLineItem[] = [
      { id: 101, ids: [101], clientId: "c-first", category: "gas", amountSen: 2000, note: "Shell" },
      { id: 102, ids: [102], clientId: "c-second", category: "gas", amountSen: 3000, note: "Shell" },
    ];

    const result = consolidateCostLines(lines);

    expect(result).toHaveLength(1);
    expect(result[0].clientId).toBe("c-first");
    expect(result[0].ids).toEqual([101, 102]);
    expect(result[0].amountSen).toBe(5000);
  });

  it("deduplicates ids when combining if same id exists across both lines", () => {
    const lines: CostLineItem[] = [
      { id: 101, ids: [101, 102], clientId: "c-1", category: "restock", amountSen: 1000, note: "Rice" },
      { id: 102, ids: [102, 103], clientId: "c-2", category: "restock", amountSen: 2000, note: "Rice" },
    ];

    const result = consolidateCostLines(lines);
    expect(result).toHaveLength(1);
    expect(result[0].ids).toEqual([101, 102, 103]);
  });
});

describe("findZeroCostLineIndex (save gate)", () => {
  it("returns -1 when all lines have amountSen > 0", () => {
    expect(findZeroCostLineIndex([{ amountSen: 100 }, { amountSen: 2000 }])).toBe(-1);
  });

  it("returns index of first line with amountSen <= 0", () => {
    expect(
      findZeroCostLineIndex([
        { amountSen: 1000 },
        { amountSen: 0 },
        { amountSen: 2000 },
      ])
    ).toBe(1);
  });

  it("returns 0 when first line is zero or negative", () => {
    expect(findZeroCostLineIndex([{ amountSen: 0 }, { amountSen: 500 }])).toBe(0);
    expect(findZeroCostLineIndex([{ amountSen: -10 }])).toBe(0);
  });

  it("returns -1 for empty lines array", () => {
    expect(findZeroCostLineIndex([])).toBe(-1);
  });
});

describe("Cost line inline errors and boxed styling parity", () => {
  it("note error uses the boxed style (class assertions)", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: [
          { category: "other", amountSen: 2000, note: "" },
        ],
        isClosed: false,
        todayKl: "2026-05-15",
        initialNoteErrorIndex: 0,
      })
    );

    // Verify error element exists with correct id and role
    expect(html).toContain('id="other-note-error-0"');
    expect(html).toContain('role="alert"');

    // Verify boxed red-tinted styling classes
    expect(html).toContain("bg-finance-loss-light");
    expect(html).toContain("border-finance-loss-border");
    expect(html).toContain("rounded-lg");
    expect(html).toContain("text-finance-loss");
    expect(html).toContain("font-medium");
    expect(html).toContain("必须填写备注说明");
    expect(html).toContain("类别为&#x27;其他&#x27;时");
  });

  it("zero-line save shows inline error state under amount input not top banner", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: [
          { category: "restock", amountSen: 0, note: "Rice" },
        ],
        isClosed: false,
        todayKl: "2026-05-15",
        initialCostAmountErrorIndex: 0,
      })
    );

    // Verify inline error under amount input exists with correct id, role, and text
    expect(html).toContain('id="cost-amount-error-0"');
    expect(html).toContain('role="alert"');
    expect(html).toContain(t.invalidAmount);

    // Verify boxed styling classes matching expenses page
    expect(html).toContain("bg-finance-loss-light");
    expect(html).toContain("border-finance-loss-border");
    expect(html).toContain("rounded-lg");
    expect(html).toContain("text-finance-loss");
    expect(html).toContain("font-medium");

    // Verify amount input receives error border and aria-invalid
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="cost-amount-error-0"');
    expect(html).toContain("border-finance-loss");

    // Verify top notification banner is NOT rendered
    expect(html).not.toContain('aria-label="Close"');
  });
});

describe("cost line consolidation on row click/expand (toggleCostLineExpansion)", () => {
  it("(a) clicking a row after a category edit that created duplicates consolidates them (amounts summed, one row left, clicked row expanded at correct new index)", () => {
    // 3 lines originally: line-1 (restock), line-2 (transport), line-3 (wages-daily)
    // User edited line-2 to match line-1 (category "restock", note "Rice")
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 2000, amountInput: "20", note: "Rice" },
      { clientId: "line-2", category: "restock", amountSen: 3000, amountInput: "30", note: "Rice" },
      { clientId: "line-3", category: "wages-daily", amountSen: 5000, amountInput: "50", note: "Chef" },
    ];

    // line-2 was active/being edited (expandedIndex = 1)
    // User now clicks line-3 (index 2 in pre-consolidation list) to expand it
    const result = toggleCostLineExpansion(lines, 2, 1);

    // Duplicates consolidate: line-1 survives, amounts sum to 5000 (RM 50)
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].clientId).toBe("line-1");
    expect(result.lines[0].category).toBe("restock");
    expect(result.lines[0].amountSen).toBe(5000);
    expect(result.lines[0].amountInput).toBe("50");

    // Clicked row (line-3, wages) shifts from index 2 to index 1 and is expanded
    expect(result.lines[1].clientId).toBe("line-3");
    expect(result.lines[1].category).toBe("wages-daily");
    expect(result.lines[1].amountSen).toBe(5000);
    expect(result.expandedIndex).toBe(1);
  });

  it("(b) clicking a row that itself duplicates an earlier one expands the surviving merged row", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 2000, amountInput: "20", note: "Rice" },
      { clientId: "line-2", category: "restock", amountSen: 3000, amountInput: "30", note: "Rice" },
      { clientId: "line-3", category: "gas", amountSen: 4000, amountInput: "40", note: "Shell" },
    ];

    // User clicks line-2 (index 1), which duplicates earlier line-1 (index 0)
    // Regardless of whether line-2 was currently expanded or collapsed,
    // the surviving merged row (index 0) must end up expanded.
    const resultFromExpanded = toggleCostLineExpansion(lines, 1, 1);
    expect(resultFromExpanded.lines).toHaveLength(2);
    expect(resultFromExpanded.lines[0].clientId).toBe("line-1");
    expect(resultFromExpanded.lines[0].category).toBe("restock");
    expect(resultFromExpanded.lines[0].amountSen).toBe(5000);
    expect(resultFromExpanded.expandedIndex).toBe(0);

    const resultFromCollapsed = toggleCostLineExpansion(lines, 1, null);
    expect(resultFromCollapsed.lines).toHaveLength(2);
    expect(resultFromCollapsed.lines[0].clientId).toBe("line-1");
    expect(resultFromCollapsed.lines[0].amountSen).toBe(5000);
    expect(resultFromCollapsed.expandedIndex).toBe(0);
  });

  it("(c) zero lines unaffected", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 2000, amountInput: "20", note: "Rice" },
      { clientId: "line-2", category: "restock", amountSen: 3000, amountInput: "30", note: "Rice" },
      { clientId: "line-zero", category: "restock", amountSen: 0, amountInput: "", note: "Rice" },
      { clientId: "line-4", category: "gas", amountSen: 1500, amountInput: "15", note: "Shell" },
    ];

    // Clicking line-4 (index 3) merges line-1 and line-2, leaving line-zero unaffected at index 1
    const result = toggleCostLineExpansion(lines, 3, null);

    expect(result.lines).toHaveLength(3);
    expect(result.lines[0].clientId).toBe("line-1");
    expect(result.lines[0].amountSen).toBe(5000);

    // Zero-amount line preserved verbatim
    expect(result.lines[1].clientId).toBe("line-zero");
    expect(result.lines[1].amountSen).toBe(0);

    // Line 4 expanded at new index 2
    expect(result.lines[2].clientId).toBe("line-4");
    expect(result.lines[2].amountSen).toBe(1500);
    expect(result.expandedIndex).toBe(2);

    // Clicking directly on a zero-amount line consolidates filled duplicates and expands the zero line
    const clickZero = toggleCostLineExpansion(lines, 2, 0);
    expect(clickZero.lines).toHaveLength(3);
    expect(clickZero.lines[1].clientId).toBe("line-zero");
    // Accordion: expanding zero line at index 1 collapses previously expanded line 0
    expect(clickZero.expandedIndex).toBe(1);

    // Clicking the already expanded zero-amount line collapses it
    const collapseZero = toggleCostLineExpansion(clickZero.lines, 1, 1);
    expect(collapseZero.expandedIndex).toBeNull();
  });

  it("allows newly added zero-amount cost item to be closed before price entered", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-new", category: "restock", amountSen: 0, amountInput: "", note: "" },
    ];

    // Initially expanded (as newly added via \"+ Add Cost\")
    const closeResult = toggleCostLineExpansion(lines, 0, 0);
    expect(closeResult.expandedIndex).toBeNull();

    // Clicking again re-expands it
    const reOpenResult = toggleCostLineExpansion(closeResult.lines, 0, null);
    expect(reOpenResult.expandedIndex).toBe(0);
  });

  it("enforces accordion behavior: expanding a second item collapses the first", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 2000, amountInput: "20", note: "Rice" },
      { clientId: "line-2", category: "gas", amountSen: 1500, amountInput: "15", note: "Shell" },
    ];

    // Initially line-1 is expanded (index 0)
    // Expanding line-2 (index 1) collapses line-1
    const expandSecond = toggleCostLineExpansion(lines, 1, 0);
    expect(expandSecond.expandedIndex).toBe(1);

    // Expanding line-1 (index 0) collapses line-2
    const expandFirst = toggleCostLineExpansion(expandSecond.lines, 0, 1);
    expect(expandFirst.expandedIndex).toBe(0);
  });

  it("toggles collapse when clicking an already expanded row that did not merge away", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 2000, amountInput: "20", note: "Rice" },
      { clientId: "line-2", category: "gas", amountSen: 1500, amountInput: "15", note: "Shell" },
    ];

    // Clicking line-1 when line-1 is already expanded collapses it
    const result = toggleCostLineExpansion(lines, 0, 0);
    expect(result.lines).toHaveLength(2);
    expect(result.expandedIndex).toBeNull();
  });

  it("remaps noteErrorIndex and costAmountErrorIndex when rows shift, avoiding stale phantom highlights", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 2000, amountInput: "20", note: "Rice" },
      { clientId: "line-2", category: "restock", amountSen: 3000, amountInput: "30", note: "Rice" },
      { clientId: "line-3", category: "other", amountSen: 1500, amountInput: "15", note: "" }, // noteError at index 2
    ];

    // User clicks line-3: duplicates (line-1 and line-2) consolidate, line-3 shifts from index 2 to index 1
    const result = toggleCostLineExpansion(lines, 2, null, {
      noteErrorIndex: 2,
      costAmountErrorIndex: null,
    });

    expect(result.lines).toHaveLength(2);
    expect(result.expandedIndex).toBe(1);
    expect(result.noteErrorIndex).toBe(1);
    expect(result.costAmountErrorIndex).toBeNull();
  });

  it("clears noteErrorIndex when the erroneous line no longer has an error after consolidation", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 2000, amountInput: "20", note: "Rice" },
      { clientId: "line-2", category: "gas", amountSen: 1500, amountInput: "15", note: "Shell" },
    ];

    // noteErrorIndex was pointing to index 0 which is not "other"
    const result = toggleCostLineExpansion(lines, 1, null, {
      noteErrorIndex: 0,
    });
    expect(result.noteErrorIndex).toBeNull();
  });
});

describe("add cost button always visible and unfilled row replacement (createNewCostLine)", () => {
  it("clicking add with only filled rows appends a fresh zero row and expands it", () => {
    const lines: CostLineItem[] = [
      { clientId: "c-1", category: "restock", amountSen: 2000, amountInput: "20", note: "Rice" },
      { clientId: "c-2", category: "gas", amountSen: 1500, amountInput: "15", note: "Shell" },
    ];

    const result = createNewCostLine(lines);

    expect(result.lines).toHaveLength(3);
    expect(result.lines[0].clientId).toBe("c-1");
    expect(result.lines[1].clientId).toBe("c-2");
    expect(result.lines[2].amountSen).toBe(0);
    expect(result.lines[2].amountInput).toBe("");
    expect(result.expandedIndex).toBe(2);
  });

  it("clicking add with an unfilled row present replaces it (no duplicate zero rows)", () => {
    const lines: CostLineItem[] = [
      { clientId: "c-1", category: "restock", amountSen: 2000, amountInput: "20", note: "Rice" },
      { clientId: "c-unfilled", category: "restock", amountSen: 0, amountInput: "", note: "" },
    ];

    const result = createNewCostLine(lines);

    // Unfilled row is replaced by a single fresh empty row; no duplicate zero rows
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].clientId).toBe("c-1");
    expect(result.lines[1].amountSen).toBe(0);
    expect(result.lines[1].clientId).not.toBe("c-unfilled");
    expect(result.expandedIndex).toBe(1);
  });

  it("consolidates duplicate filled lines before replacing unfilled row on add", () => {
    const lines: CostLineItem[] = [
      { clientId: "c-1", category: "restock", amountSen: 2000, amountInput: "20", note: "Rice" },
      { clientId: "c-2", category: "restock", amountSen: 3000, amountInput: "30", note: "Rice" },
      { clientId: "c-zero", category: "restock", amountSen: 0, amountInput: "", note: "" },
    ];

    const result = createNewCostLine(lines);

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].clientId).toBe("c-1");
    expect(result.lines[0].amountSen).toBe(5000);
    expect(result.lines[1].amountSen).toBe(0);
    expect(result.expandedIndex).toBe(1);
  });

  it("renders the add cost button even when an unfilled zero row exists", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: [
          { category: "restock", amountSen: 0, note: "Rice" },
        ],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    // Button text "添加开销" is rendered despite zero-amount row
    expect(html).toContain(t.addCostLine);
  });

  it("hides the add cost button when sheet is closed", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: [
          { category: "restock", amountSen: 2000, note: "Rice" },
        ],
        isClosed: true,
        todayKl: "2026-05-15",
      })
    );

    expect(html).not.toContain(t.addCostLine);
  });
});


describe("DailySheetForm component cost item accordion and close behavior", () => {
  it("renders newly added zero-amount cost item as closable and collapsed when closed", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: [
          { clientId: "new-line", category: "restock", amountSen: 0, note: "" },
        ],
        initialExpandedIndex: null,
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    const costSection = html.slice(html.indexOf('aria-label="Daily Costs Entry"'));

    // The card is closed: aria-expanded="false" and cost input is NOT rendered
    expect(costSection).toContain('aria-expanded="false"');
    expect(costSection).not.toContain('aria-expanded="true"');
    expect(costSection).not.toContain('placeholder="0.00"');
    // Summary row is clickable and interactive (not disabled)
    expect(costSection).toContain('tabindex="0"');
    expect(costSection).toContain("cursor-pointer");
    expect(costSection).not.toContain("aria-disabled");
  });

  it("renders newly added zero-amount cost item as expanded by default or when opened", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: [
          { clientId: "new-line", category: "restock", amountSen: 0, note: "" },
        ],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    const costSection = html.slice(html.indexOf('aria-label="Daily Costs Entry"'));

    // Rendered expanded: aria-expanded="true" and cost amount input is rendered
    expect(costSection).toContain('aria-expanded="true"');
    expect(costSection).toContain('placeholder="0.00"');
  });

  it("accordion behavior: expanding a second item collapses the first (only ONE item expanded at a time)", () => {
    const lines = [
      { clientId: "line-1", category: "restock" as const, amountSen: 2000, note: "Rice" },
      { clientId: "line-2", category: "gas" as const, amountSen: 1500, note: "Shell" },
    ];

    // Case 1: First item is expanded
    const htmlItem0 = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: lines,
        initialExpandedIndex: 0,
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    const costSection0 = htmlItem0.slice(htmlItem0.indexOf('aria-label="Daily Costs Entry"'));
    const trueCount0 = (costSection0.match(/aria-expanded="true"/g) || []).length;
    const falseCount0 = (costSection0.match(/aria-expanded="false"/g) || []).length;
    expect(trueCount0).toBe(1);
    expect(falseCount0).toBe(1);

    // Case 2: Second item is expanded (expanding second collapses first)
    const htmlItem1 = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: lines,
        initialExpandedIndex: 1,
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    const costSection1 = htmlItem1.slice(htmlItem1.indexOf('aria-label="Daily Costs Entry"'));
    const trueCount1 = (costSection1.match(/aria-expanded="true"/g) || []).length;
    const falseCount1 = (costSection1.match(/aria-expanded="false"/g) || []).length;
    expect(trueCount1).toBe(1);
    expect(falseCount1).toBe(1);
  });

  it("accordion behavior: a new zero-amount item does NOT stay open when an existing item is expanded", () => {
    const lines = [
      { clientId: "line-1", category: "restock" as const, amountSen: 2000, note: "Rice" },
      { clientId: "line-new", category: "other" as const, amountSen: 0, note: "" },
    ];

    // When item 0 (Rice) is expanded, the new zero item must be collapsed
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: lines,
        initialExpandedIndex: 0,
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    const costSection = html.slice(html.indexOf('aria-label="Daily Costs Entry"'));
    const trueCount = (costSection.match(/aria-expanded="true"/g) || []).length;
    const falseCount = (costSection.match(/aria-expanded="false"/g) || []).length;
    expect(trueCount).toBe(1);
    expect(falseCount).toBe(1);
  });
});

describe("DailySheetForm long money amount dynamic sizing", () => {
  it("applies shrink classes when formatted money amounts exceed 11 characters", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 100568612, // RM1005686.12 -> 12 chars
        initialTngSen: 0,
        initialCostLines: [
          {
            clientId: "c-long",
            category: "restock",
            amountSen: 120000000, // RM1200000.00 -> 12 chars
            note: "Huge order",
          },
        ],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    // Cost line summary amount: RM1200000.00 (12 chars) -> replaces text-base with text-xs (no coexistence)
    expect(html).toContain("RM1200000.00");
    expect(html).toMatch(/class="[^"]*text-xs font-bold text-slate-700 tabular-nums whitespace-nowrap"[^>]*>RM1200000\.00/);
    expect(html).not.toMatch(/class="[^"]*text-base[^"]*"[^>]*>RM1200000\.00/);

    // Sticky bottom bar gross profit: 100568612 - 120000000 = -19431388 -> -RM194313.88 (13 chars) -> text-base
    expect(html).toContain("-RM194313.88");
    expect(html).toMatch(/class="[^"]*text-base font-bold text-finance-loss"[^>]*>-RM194313\.88/);
    expect(html).not.toMatch(/class="[^"]*text-xl font-bold text-finance-loss"[^>]*>-RM194313\.88/);
  });

  it("keeps standard base classes when formatted money amounts are <= 11 characters", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 50000000, // RM500000.00 -> 11 chars
        initialTngSen: 0,
        initialCostLines: [
          {
            clientId: "c-normal",
            category: "restock",
            amountSen: 50000000, // RM500000.00 -> 11 chars
            note: "Standard order",
          },
        ],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    // Cost line summary amount: RM500000.00 (11 chars) -> no text-xs
    expect(html).toMatch(/class="[^"]*text-base font-bold text-slate-700 tabular-nums whitespace-nowrap"[^>]*>RM500000\.00/);
    expect(html).not.toMatch(/class="[^"]*text-xs[^"]*"[^>]*>RM500000\.00/);

    // Sticky bottom bar gross profit: RM0.00 (6 chars) -> text-xl
    expect(html).toContain("RM0.00");
    expect(html).toMatch(/class="[^"]*text-xl font-bold text-brand-broccoli"[^>]*>RM0\.00/);
    expect(html).not.toMatch(/class="[^"]*text-base font-bold text-brand-broccoli"[^>]*>RM0\.00/);
  });
});

describe("in-flight edit rebase (rebaseCostLinesAfterSave)", () => {
  const savedLines: CostLineItem[] = [
    { category: "restock", amountSen: 5000, amountInput: "50", note: "veg", ids: [11] },
    { category: "gas", amountSen: 2500, amountInput: "25", note: null, ids: [12] },
  ];

  it("takes the server snapshot verbatim when the draft was untouched during the flight", () => {
    const local: CostLineItem[] = [
      { category: "restock", amountSen: 5000, amountInput: "50", note: "veg", ids: [] },
      { category: "gas", amountSen: 2500, amountInput: "25", note: null, ids: [] },
    ];

    expect(rebaseCostLinesAfterSave(local, savedLines, false)).toBe(savedLines);
  });

  it("keeps an amount typed during the save instead of discarding it for the snapshot", () => {
    // Mom retyped the restock amount while the POST was still in flight.
    const local: CostLineItem[] = [
      { category: "restock", amountSen: 5000, amountInput: "50", note: "veg", ids: [] },
      { category: "gas", amountSen: 2500, amountInput: "25", note: null, ids: [] },
      { category: "transport", amountSen: 1200, amountInput: "12", note: null, clientId: "line-x", ids: [] },
    ];

    const rebased = rebaseCostLinesAfterSave(local, savedLines, true);

    // No keystrokes lost: the mid-flight line survives exactly as typed.
    expect(rebased).toHaveLength(3);
    expect(rebased[2]).toEqual(local[2]);
    expect(rebased[2].ids).toEqual([]);

    // Rows that still match the snapshot adopt the saved ids, so the baseline
    // diff flags only the line she actually changed.
    expect(rebased[0].ids).toEqual([11]);
    expect(rebased[1].ids).toEqual([12]);
  });

  it("keeps a half-typed amount string and a note edited mid-flight", () => {
    const local: CostLineItem[] = [
      { category: "restock", amountSen: 5000, amountInput: "50.", note: "veg", ids: [] },
      { category: "gas", amountSen: 2500, amountInput: "25", note: "cylinder", ids: [] },
    ];

    const rebased = rebaseCostLinesAfterSave(local, savedLines, true);

    // Same amountSen as the snapshot, so the row adopts the id but keeps her
    // in-progress input string rather than the normalised server rendering.
    expect(rebased[0].amountInput).toBe("50.");
    expect(rebased[0].ids).toEqual([11]);

    // The note differs from the snapshot: her text wins and no id is adopted,
    // so isModified stays true and the next save re-sends the merged draft.
    expect(rebased[1].note).toBe("cylinder");
    expect(rebased[1].ids).toEqual([]);
  });

  it("keeps a line deleted during the flight deleted", () => {
    const local: CostLineItem[] = [
      { category: "restock", amountSen: 5000, amountInput: "50", note: "veg", ids: [] },
    ];

    const rebased = rebaseCostLinesAfterSave(local, savedLines, true);

    expect(rebased).toHaveLength(1);
    expect(rebased[0].category).toBe("restock");
    expect(rebased[0].ids).toEqual([11]);
  });

  it("does not hand the same saved row's ids to two identical local rows", () => {
    const local: CostLineItem[] = [
      { category: "gas", amountSen: 2500, amountInput: "25", note: null, ids: [] },
      { category: "gas", amountSen: 2500, amountInput: "25", note: null, clientId: "line-dup", ids: [] },
    ];

    const rebased = rebaseCostLinesAfterSave(local, savedLines, true);

    expect(rebased[0].ids).toEqual([12]);
    expect(rebased[1].ids).toEqual([]);
  });

  it("treats whitespace-only note differences as the same row", () => {
    const local: CostLineItem[] = [
      { category: "restock", amountSen: 5000, amountInput: "50", note: "  veg  ", ids: [] },
    ];

    expect(rebaseCostLinesAfterSave(local, savedLines, true)[0].ids).toEqual([11]);
  });
});

describe("shared merge rule in the form (Phase 7)", () => {
  const MAX = Number.MAX_SAFE_INTEGER;

  it("merged row carries every underlying id once, including a bare id, so deleting it drops the group", () => {
    const merged = consolidateCostLines([
      { id: 7, clientId: "c-7", category: "restock", amountSen: 1000, note: "Rice" },
      { id: 8, ids: [8, 9], category: "restock", amountSen: 2000, note: " Rice " },
      { ids: [7], category: "restock", amountSen: 500, note: "Rice" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].ids).toEqual([7, 8, 9]);
    expect(merged[0].id).toBeUndefined();
    expect(merged[0].amountSen).toBe(3500);
    expect(merged[0].amountInput).toBe("35");
    expect(merged[0].clientId).toBe("c-7");

    const afterDelete = merged.filter((_, i) => i !== 0);
    expect(afterDelete.flatMap((l) => l.ids ?? [])).toEqual([]);
  });

  it("keeps the first clientId that exists when the first member has none", () => {
    const merged = consolidateCostLines([
      { id: 1, category: "gas", amountSen: 100 },
      { clientId: "c-new", category: "gas", amountSen: 200, note: "  " },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].clientId).toBe("c-new");
    expect(merged[0].ids).toEqual([1]);
  });

  it("an unmerged row keeps its object identity so in-progress input (e.g. '12.50') is untouched", () => {
    const typing: CostLineItem = { clientId: "c-1", category: "gas", amountSen: 1250, amountInput: "12.50", note: "Shell " };
    const result = consolidateCostLines([typing]);
    expect(result[0]).toBe(typing);
    expect(result[0].amountInput).toBe("12.50");
  });

  it("load path no longer merges unsaved zero drafts, only positive rows", () => {
    const loaded = mergeCostLines([
      { category: "restock", amountSen: 0, note: "Rice" },
      { id: 1, category: "restock", amountSen: 1000, note: "Rice" },
      { category: "restock", amountSen: 0, note: "Rice " },
      { id: 2, category: "restock", amountSen: 500, note: "Rice" },
    ]);
    expect(loaded.map((l) => l.amountSen)).toEqual([0, 1500, 0]);
    expect(loaded[1].ids).toEqual([1, 2]);
    expect(loaded[2].note).toBe("Rice");
  });

  it("matches the server merge output for the same submitted lines", () => {
    // Same fixture as the service parity test in daily-sheet.test.ts
    const lines: CostLineItem[] = [
      { category: "restock", amountSen: 2000, note: " rice " },
      { category: "gas", amountSen: 700, note: null },
      { category: "restock", amountSen: 3000, note: "rice" },
      { category: "gas", amountSen: 300, note: "   " },
      { category: "other", amountSen: 900, note: "rice" },
    ];
    const client = consolidateCostLines(lines).map((l) => ({
      category: l.category,
      note: (l.note ?? "").trim() || null,
      amountSen: l.amountSen,
    }));
    expect(client).toEqual([
      { category: "restock", note: "rice", amountSen: 5000 },
      { category: "gas", note: null, amountSen: 1000 },
      { category: "other", note: "rice", amountSen: 900 },
    ]);
  });

  it("consolidate throws with the draft index of the overflowing row (zero drafts do not shift it)", () => {
    let caught: unknown;
    try {
      consolidateCostLines([
        { clientId: "z", category: "gas", amountSen: 0 },
        { clientId: "a", category: "restock", amountSen: MAX, note: "Rice" },
        { clientId: "b", category: "restock", amountSen: 1, note: "Rice" },
      ]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CostLineAmountOverflowError);
    expect((caught as CostLineAmountOverflowError).index).toBe(2);
  });

  it("save gate blocks an overflowing merge on the offending row and keeps the draft unmerged", () => {
    const draft: CostLineItem[] = [
      { clientId: "a", category: "restock", amountSen: MAX, note: "Rice" },
      { clientId: "b", category: "restock", amountSen: 1, note: "Rice" },
    ];
    const result = consolidateCostLinesForSave(draft);
    expect(result.amountErrorIndex).toBe(1);
    expect(result.lines).toBe(draft);
    expect(result.lines.map((l) => l.amountSen)).toEqual([MAX, 1]);
  });

  it("save gate still flags an unsaved zero draft after merging, and passes a clean draft", () => {
    const withZero = consolidateCostLinesForSave([
      { clientId: "a", category: "gas", amountSen: 100 },
      { clientId: "b", category: "gas", amountSen: 200 },
      { clientId: "c", category: "restock", amountSen: 0 },
    ]);
    expect(withZero.amountErrorIndex).toBe(1);
    expect(withZero.lines.map((l) => l.amountSen)).toEqual([300, 0]);

    const clean = consolidateCostLinesForSave([
      { clientId: "a", category: "gas", amountSen: 100 },
      { clientId: "b", category: "gas", amountSen: 200 },
    ]);
    expect(clean.amountErrorIndex).toBeNull();
    expect(clean.lines).toHaveLength(1);
    expect(clean.lines[0].amountSen).toBe(300);
  });

  it("tryConsolidateCostLines reports overflow without throwing or mutating", () => {
    const draft: CostLineItem[] = [
      { category: "gas", amountSen: MAX },
      { category: "gas", amountSen: MAX },
    ];
    const result = tryConsolidateCostLines(draft);
    expect(result.overflowIndex).toBe(1);
    expect(result.lines).toBe(draft);
  });

  it("expand on an overflowing draft toggles without merging and keeps error indexes", () => {
    const draft: CostLineItem[] = [
      { clientId: "a", category: "gas", amountSen: MAX },
      { clientId: "b", category: "gas", amountSen: 5 },
      { clientId: "c", category: "other", amountSen: 100, note: "" },
    ];
    const opened = toggleCostLineExpansion(draft, 1, null, { noteErrorIndex: 2, costAmountErrorIndex: 1 });
    expect(opened.lines).toBe(draft);
    expect(opened.expandedIndex).toBe(1);
    expect(opened.noteErrorIndex).toBe(2);
    expect(opened.costAmountErrorIndex).toBe(1);

    const closed = toggleCostLineExpansion(draft, 1, 1);
    expect(closed.expandedIndex).toBeNull();
  });

  it("add on an overflowing draft appends a fresh row without merging or clamping", () => {
    const draft: CostLineItem[] = [
      { clientId: "a", category: "gas", amountSen: MAX },
      { clientId: "b", category: "gas", amountSen: 5 },
      { clientId: "z", category: "gas", amountSen: 0 },
    ];
    const result = createNewCostLine(draft, () => ({ clientId: "new", category: "restock", amountSen: 0 }));
    expect(result.lines.map((l) => l.clientId)).toEqual(["a", "b", "new"]);
    expect(result.lines.map((l) => l.amountSen)).toEqual([MAX, 5, 0]);
    expect(result.expandedIndex).toBe(2);
  });
});
