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
  toSen,
  mergeCostLines,
  appendOrMergeCostLine,
  applyCostLineUpdate,
  getCostLineKey,
  type CostLineItem,
} from "./DailySheetForm";
import { DICTIONARY, translateApiError } from "@/lib/i18n";

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

describe("mergeCostLines, appendOrMergeCostLine, getCostLineKey, and deletion logic", () => {
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

describe("live editing cost line auto-merge (applyCostLineUpdate)", () => {
  // (a) editing a line to match another merges + sums
  it("merges and sums amounts when editing note so category and note match an existing line", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 2000, amountInput: "20", note: "Rice" },
      { clientId: "line-2", category: "restock", amountSen: 3000, amountInput: "30", note: "Ric" },
    ];

    const result = applyCostLineUpdate(lines, 1, { note: "Rice" });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].category).toBe("restock");
    expect(result.lines[0].note).toBe("Rice");
    expect(result.lines[0].amountSen).toBe(5000);
    expect(result.lines[0].amountInput).toBe("50");
    expect(result.expandedIndex).toBe(0);
  });

  it("merges and sums amounts when editing category so it matches an existing line", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 1500, note: "Shell" },
      { clientId: "line-2", category: "gas", amountSen: 2500, note: "Shell" },
    ];

    const result = applyCostLineUpdate(lines, 1, { category: "restock" });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].category).toBe("restock");
    expect(result.lines[0].amountSen).toBe(4000);
    expect(result.lines[0].amountInput).toBe("40");
    expect(result.expandedIndex).toBe(0);
  });

  it("merges and sums amounts when editing amount from 0 to > 0 on a matching category and note line", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 4000, note: "Rice" },
      { clientId: "line-2", category: "restock", amountSen: 0, note: "Rice" },
    ];

    const result = applyCostLineUpdate(lines, 1, { amountSen: 1000, amountInput: "10" });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].amountSen).toBe(5000);
    expect(result.lines[0].amountInput).toBe("50");
    expect(result.expandedIndex).toBe(0);
  });

  it("caps merged amount at MAX_SAFE_SEN upon overflow", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: Number.MAX_SAFE_INTEGER, note: "Rice" },
      { clientId: "line-2", category: "restock", amountSen: 1000, note: "Rice" },
    ];

    const result = applyCostLineUpdate(lines, 1, { note: "Rice" });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].amountSen).toBe(Number.MAX_SAFE_INTEGER);
  });

  // (b) zero-amount line never merges
  it("never merges zero-amount lines even when category and note match", () => {
    const lines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 2000, note: "" },
      { clientId: "line-2", category: "restock", amountSen: 0, note: "" },
    ];

    // Editing note on zero-amount line
    const res1 = applyCostLineUpdate(lines, 1, { note: "   " });
    expect(res1.lines).toHaveLength(2);
    expect(res1.lines[0].amountSen).toBe(2000);
    expect(res1.lines[1].amountSen).toBe(0);
    expect(res1.expandedIndex).toBe(1);

    // Two zero-amount lines do not merge
    const zeroLines: CostLineItem[] = [
      { clientId: "line-1", category: "restock", amountSen: 0, note: "Rice" },
      { clientId: "line-2", category: "restock", amountSen: 0, note: "Rice" },
    ];
    const res2 = applyCostLineUpdate(zeroLines, 1, { note: "Rice" });
    expect(res2.lines).toHaveLength(2);
    expect(res2.expandedIndex).toBe(1);

    // Editing an amount to 0 does not merge with a zero-amount line
    const res3 = applyCostLineUpdate(lines, 0, { amountSen: 0, amountInput: "" });
    expect(res3.lines).toHaveLength(2);
    expect(res3.expandedIndex).toBe(0);
  });

  // (c) ids combine and first-position kept
  it("combines ids and keeps the first line position and clientId when editing second line to match first", () => {
    const lines: CostLineItem[] = [
      { id: 101, ids: [101], clientId: "c-first", category: "gas", amountSen: 2000, note: "Shell" },
      { id: 102, ids: [102], clientId: "c-second", category: "gas", amountSen: 3000, note: "Petronas" },
    ];

    // User edits second line (index 1) to match first line
    const result = applyCostLineUpdate(lines, 1, { note: "Shell" });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].clientId).toBe("c-first");
    expect(result.lines[0].ids).toEqual([101, 102]);
    expect(result.lines[0].amountSen).toBe(5000);
    expect(result.expandedIndex).toBe(0);
  });

  it("combines ids and keeps the first line position and clientId when editing first line to match second", () => {
    const lines: CostLineItem[] = [
      { id: 101, clientId: "c-first", category: "gas", amountSen: 2000, note: "Petronas" },
      { id: 102, ids: [102, 103], clientId: "c-second", category: "gas", amountSen: 3000, note: "Shell" },
    ];

    // User edits first line (index 0) to match second line
    const result = applyCostLineUpdate(lines, 0, { note: "Shell" });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].clientId).toBe("c-first");
    expect(result.lines[0].ids).toEqual([101, 102, 103]);
    expect(result.lines[0].amountSen).toBe(5000);
    expect(result.expandedIndex).toBe(0);
  });

  it("deduplicates ids when combining if same id exists across both lines", () => {
    const lines: CostLineItem[] = [
      { id: 101, ids: [101, 102], clientId: "c-1", category: "restock", amountSen: 1000, note: "Rice" },
      { id: 102, ids: [102, 103], clientId: "c-2", category: "restock", amountSen: 2000, note: "Rice" },
    ];

    const result = applyCostLineUpdate(lines, 1, { category: "restock" });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].ids).toEqual([101, 102, 103]);
  });

  // Stale noteErrorIndex clearing and remapping
  it("clears noteErrorIndex when editing the note of the flagged line without merge", () => {
    const lines: CostLineItem[] = [
      { clientId: "l1", category: "other", amountSen: 2000, note: "" },
    ];
    const result = applyCostLineUpdate(lines, 0, { note: "Supplies" }, 0);
    expect(result.noteErrorIndex).toBeNull();
  });

  it("clears noteErrorIndex when changing the category of the flagged line away from other", () => {
    const lines: CostLineItem[] = [
      { clientId: "l1", category: "other", amountSen: 2000, note: "" },
    ];
    const result = applyCostLineUpdate(lines, 0, { category: "restock" }, 0);
    expect(result.noteErrorIndex).toBeNull();
  });

  it("clears noteErrorIndex when flagged line merges into a non-other row (no phantom highlight)", () => {
    const lines: CostLineItem[] = [
      { clientId: "l1", category: "restock", amountSen: 2000, note: "Rice" },
      { clientId: "l2", category: "other", amountSen: 3000, note: "" },
    ];
    // Line 1 is flagged (noteErrorIndex = 1), user edits line 1 to match line 0
    const result = applyCostLineUpdate(
      lines,
      1,
      { category: "restock", note: "Rice" },
      1
    );
    expect(result.lines).toHaveLength(1);
    expect(result.noteErrorIndex).toBeNull();
  });

  it("remaps noteErrorIndex to firstIndex when flagged line is removed in merge and merged row still lacks other note", () => {
    const lines: CostLineItem[] = [
      { clientId: "l1", category: "other", amountSen: 2000, note: "" },
      { clientId: "l2", category: "other", amountSen: 3000, note: "" },
    ];
    // Line 1 is flagged (noteErrorIndex = 1), user updates amount of line 1 to merge into line 0
    const result = applyCostLineUpdate(lines, 1, { amountSen: 4000 }, 1);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].category).toBe("other");
    expect(result.noteErrorIndex).toBe(0);
  });

  it("shifts noteErrorIndex down by 1 when a line before it is dropped in a merge", () => {
    const lines: CostLineItem[] = [
      { clientId: "l1", category: "restock", amountSen: 2000, note: "Rice" },
      { clientId: "l2", category: "restock", amountSen: 1000, note: "Ric" },
      { clientId: "l3", category: "other", amountSen: 5000, note: "" },
    ];
    // Line 2 (l3) is flagged as noteErrorIndex = 2
    // User edits Line 1 (l2) note to "Rice" -> merges with Line 0 (l1), dropping index 1
    const result = applyCostLineUpdate(lines, 1, { note: "Rice" }, 2);
    expect(result.lines).toHaveLength(2);
    expect(result.noteErrorIndex).toBe(1);
  });

  it("leaves noteErrorIndex unchanged when a merge happens after it", () => {
    const lines: CostLineItem[] = [
      { clientId: "l1", category: "other", amountSen: 5000, note: "" },
      { clientId: "l2", category: "restock", amountSen: 2000, note: "Rice" },
      { clientId: "l3", category: "restock", amountSen: 1000, note: "Ric" },
    ];
    // Line 0 is flagged as noteErrorIndex = 0
    // User edits Line 2 note to "Rice" -> merges with Line 1, dropping index 2
    const result = applyCostLineUpdate(lines, 2, { note: "Rice" }, 0);
    expect(result.lines).toHaveLength(2);
    expect(result.noteErrorIndex).toBe(0);
  });
});
