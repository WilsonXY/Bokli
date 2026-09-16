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
  validateDailySheetCostLines,
  submitDailySheet,
  createDailySheetFormLogic,
  getCostLineKey,
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

    // Verify revenue preview displays dash rather than RM 0.00
    expect(html).toContain("—");
    expect(html).not.toContain("RM 0.00");
  });

  it("renders inline error message, error border, and dash preview for invalid TnG input", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 0,
        initialCashInput: "50.00",
        initialTngInput: "12.34.56",
        initialCostLines: [],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    expect(html).toContain(t.invalidAmount);
    expect(html).toContain("border-finance-loss");
    expect(html).toContain("—");
  });

  it("does not render inline error when cash input is empty or valid", () => {
    const htmlEmpty = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 0,
        initialTngSen: 0,
        initialCashInput: "",
        initialTngInput: "",
        initialCostLines: [],
        isClosed: false,
        todayKl: "2026-05-15",
      })
    );

    expect(htmlEmpty).not.toContain(t.invalidAmount);

    const htmlValid = ReactDOMServer.renderToStaticMarkup(
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

    expect(htmlValid).not.toContain(t.invalidAmount);
  });
});

describe("DailySheetForm mergeCostLines data integrity & group delete", () => {
  it("merges matching category and identical note items into a single line", () => {
    const items: CostLineItem[] = [
      { id: 1, category: "restock", amountSen: 2000, note: "Rice" },
      { id: 2, category: "restock", amountSen: 3000, note: "Rice" },
      { id: 3, category: "gas", amountSen: 1500, note: null },
    ];

    const merged = mergeCostLines(items);
    expect(merged).toHaveLength(2);

    const restockLine = merged.find((l) => l.category === "restock");
    expect(restockLine).toBeDefined();
    expect(restockLine?.amountSen).toBe(5000);
    expect(restockLine?.ids).toEqual([1, 2]);
    expect(restockLine?.note).toBe("Rice");

    const gasLine = merged.find((l) => l.category === "gas");
    expect(gasLine).toBeDefined();
    expect(gasLine?.amountSen).toBe(1500);
    expect(gasLine?.ids).toEqual([3]);
  });

  it("does not merge items with different notes in the same category", () => {
    const items: CostLineItem[] = [
      { id: 1, category: "restock", amountSen: 2000, note: "Rice" },
      { id: 2, category: "restock", amountSen: 3000, note: "Oil" },
    ];

    const merged = mergeCostLines(items);
    expect(merged).toHaveLength(2);
  });

  it("treats null, empty string, and whitespace-only notes as identical for merging", () => {
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

  it("generates stable unique keys with getCostLineKey", () => {
    const itemWithId: CostLineItem = { id: 42, category: "gas", amountSen: 1000 };
    expect(getCostLineKey(itemWithId)).toBe("cost-line-42");

    const itemWithIds: CostLineItem = { ids: [10, 5], category: "restock", amountSen: 2000 };
    expect(getCostLineKey(itemWithIds)).toBe("cost-line-5-10");

    const itemWithClientId: CostLineItem = { clientId: "client-abc", category: "gas", amountSen: 1000 };
    expect(getCostLineKey(itemWithClientId)).toBe("cost-line-client-abc");

    const newItemWithNote: CostLineItem = { category: "maintenance", amountSen: 500, note: "Door handle" };
    expect(getCostLineKey(newItemWithNote)).toBe("cost-line-maintenance-Door handle");

    const fallback: CostLineItem = { category: "other", amountSen: 100 };
    expect(getCostLineKey(fallback, 3)).toBe("cost-line-other-3");
  });
});

describe("Client-side pre-submit validation for 'other' category cost lines (Layer A)", () => {
  it("validateDailySheetCostLines returns all invalid indices and flags lines where category is 'other' with empty note", () => {
    const invalidEmpty: CostLineItem[] = [
      { category: "restock", amountSen: 2000, note: null },
      { category: "other", amountSen: 1500, note: "" }, // idx 1
      { category: "gas", amountSen: 1000, note: null },
      { category: "other", amountSen: 2500, note: "   " }, // idx 3
    ];
    const res = validateDailySheetCostLines(invalidEmpty);
    expect(res.isValid).toBe(false);
    expect(res.invalidIndices).toEqual([1, 3]);
    expect(res.invalidIndex).toBe(1);
    expect(res.error).toBe("otherNoteRequired");

    const validLines: CostLineItem[] = [
      { category: "other", amountSen: 1500, note: "Plastic spoons" },
      { category: "gas", amountSen: 2000, note: null },
    ];
    const resValid = validateDailySheetCostLines(validLines);
    expect(resValid.isValid).toBe(true);
    expect(resValid.invalidIndices).toEqual([]);
    expect(resValid.invalidIndex).toBeNull();
  });

  it("submitDailySheet blocks network call client-side when an other-category line has an empty note", async () => {
    const mockFetch = vi.fn();

    const costLines: CostLineItem[] = [
      { category: "restock", amountSen: 3000, note: "Flour" },
      { category: "other", amountSen: 1200, note: "" }, // Invalid!
    ];

    const result = await submitDailySheet({
      date: "2026-05-15",
      cashSen: 5000n,
      tngSen: 5000n,
      costLines,
      fetchFn: mockFetch as any,
    });

    // Network request must NOT be sent
    expect(mockFetch).not.toHaveBeenCalled();

    // Blocked client-side
    expect(result.success).toBe(false);
    expect(result.blockedClientSide).toBe(true);
    expect(result.invalidIndices).toEqual([1]);
    expect(result.invalidOtherIndex).toBe(1);
    expect(result.error).toBe("otherNoteRequired");
  });

  it("submitDailySheet permits network call when other-category line has a valid note", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sheet: { id: 1, cashSen: 5000, tngSen: 5000 }, costLines: [] }),
    });

    const costLines: CostLineItem[] = [
      { category: "other", amountSen: 1200, note: "Cleaning sponge" },
    ];

    const result = await submitDailySheet({
      date: "2026-05-15",
      cashSen: 5000n,
      tngSen: 5000n,
      costLines,
      fetchFn: mockFetch as any,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("respects amount-before-note validation order: zero/empty amount produces invalidAmount before otherNoteRequired", () => {
    // Priority rule: Amount must be valid and > 0 before checking note requirements; an empty/RM0 line is incomplete input (invalidAmount) rather than a note omission (otherNoteRequired).
    const form = createDailySheetFormLogic({
      date: "2026-05-15",
      initialCashSen: 5000,
      initialTngSen: 5000,
      initialCostLines: [
        { category: "other", amountSen: 0, note: "" }, // Zero amount AND empty note
      ],
      isClosed: false,
      todayKl: "2026-05-15",
      t,
    });

    form.onSaveClick();
    expect(form.getState().errorMessage).toBe(t.invalidAmount);
    expect(form.getState().noteErrorIndices.size).toBe(0);
    expect(form.getState().showConfirmModal).toBe(false);
  });

  it("interaction-style test: user clicks Save with an empty-note other line -> fetch NOT called, aria-invalid/focus set, and inline error rendered", async () => {
    const mockFetch = vi.fn();

    const form = createDailySheetFormLogic({
      date: "2026-05-15",
      initialCashSen: 5000,
      initialTngSen: 5000,
      initialCostLines: [
        { category: "gas", amountSen: 1000, note: null },
        { category: "other", amountSen: 2500, note: "" }, // line 1 invalid
      ],
      isClosed: false,
      todayKl: "2026-05-15",
      fetchFn: mockFetch as any,
      t,
    });

    // 1. User clicks Save button (real prod save gate flow)
    form.onSaveClick();

    // Assert: Network fetch was NOT called
    expect(mockFetch).not.toHaveBeenCalled();

    // Assert: Invalid line 1 is flagged in noteErrorIndices
    expect(form.getState().noteErrorIndices.has(1)).toBe(true);
    // Invalid line is expanded and targeted for focus
    expect(form.getState().expandedIndex).toBe(1);
    expect(form.getState().focusNoteIndex).toBe(1);
    // Confirm modal did not open and no scary generic red save error banner
    expect(form.getState().showConfirmModal).toBe(false);
    expect(form.getState().errorMessage).toBeNull();

    // 2. Render the DailySheetForm with this live form state
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DailySheetForm, {
        date: "2026-05-15",
        initialCashSen: 5000,
        initialTngSen: 5000,
        initialCostLines: form.getState().costLines,
        isClosed: false,
        todayKl: "2026-05-15",
        formLogic: form,
      })
    );

    // Assert: Rendered markup has error border and aria-invalid on the note input
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("border-finance-loss");
    // Assert: Rendered markup displays the inline otherNoteRequired message
    expect(html).toContain(t.otherNoteRequired);
    // Assert: The scary generic save error bar and variance message must NOT appear
    expect(html).not.toContain(t.saveError);
    expect(html).not.toContain(t.varianceNoteRequired);

    // 3. Inline path: User tries to click "+ Add Cost" while invalid lines exist
    form.handleCreateNewCostLine();
    // Blocked: line count stays 2, does not add runaway empty lines
    expect(form.getState().costLines).toHaveLength(2);

    // 4. User adds a second other line via inline update on new cost line
    // First fix line 1 note
    form.handleUpdateCostLine(1, { note: "Office supplies" });
    expect(form.getState().noteErrorIndices.has(1)).toBe(false);
    expect(form.getState().noteErrorIndices.size).toBe(0);

    // Now clicking "+ Add Cost" succeeds
    form.handleCreateNewCostLine();
    expect(form.getState().costLines).toHaveLength(3);
    const newLineIdx = 2;
    // Changing new line category to "other" without a note triggers inline noteErrorIndices immediately!
    form.handleUpdateCostLine(newLineIdx, { category: "other", amountSen: 1500 });
    expect(form.getState().noteErrorIndices.has(newLineIdx)).toBe(true);

    // Typing note on new line clears its error
    form.handleUpdateCostLine(newLineIdx, { note: "Cleaning sponge" });
    expect(form.getState().noteErrorIndices.size).toBe(0);

    // 5. User clicks Save now: validation passes and confirm modal opens
    form.onSaveClick();
    expect(form.getState().showConfirmModal).toBe(true);

    // 6. User confirms save in modal: handleSave executes real network submit
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sheet: { id: 1, cashSen: 5000, tngSen: 5000 },
        costLines: [
          { id: 10, category: "gas", amountSen: 1000 },
          { id: 11, category: "other", amountSen: 2500, note: "Office supplies" },
          { id: 12, category: "other", amountSen: 1500, note: "Cleaning sponge" },
        ],
      }),
    });

    await form.handleSave();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(form.getState().successMessage).toBe(t.saveSuccess);
  });
});
