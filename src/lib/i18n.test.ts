import { describe, it, expect } from "vitest";
import { DICTIONARY, translateApiError } from "./i18n";

describe("i18n translateApiError mapping and idempotency", () => {
  const zh = DICTIONARY.zh;
  const en = DICTIONARY.en;

  it("maps 'Note is required when Cost Category is other' to otherNoteRequired in zh and en", () => {
    const errorMsg = "Note is required when Cost Category is 'other'";
    expect(translateApiError(errorMsg, zh)).toBe("「其他」分类必须填写备注");
    expect(translateApiError(errorMsg, en)).toBe("A note is required for the 'Other' category");
  });

  it("maps 'Note is required when Operating Expense type is other' to otherNoteRequired", () => {
    const errorMsg = "Note is required when Operating Expense type is 'other'";
    expect(translateApiError(errorMsg, zh)).toBe(zh.otherNoteRequired);
    expect(translateApiError(errorMsg, en)).toBe(en.otherNoteRequired);
  });

  it("maps generic 'note is required' to otherNoteRequired rather than borrowing varianceNoteRequired", () => {
    const errorMsg = "note is required";
    expect(translateApiError(errorMsg, zh)).toBe(zh.otherNoteRequired);
    expect(translateApiError(errorMsg, zh)).not.toBe(zh.varianceNoteRequired);
  });

  it("prevents false positives with word-boundary matching on 'another' and 'mother'", () => {
    // "another note" or "mother's note" should NOT trigger otherNoteRequired
    expect(translateApiError("another note was rejected", zh)).not.toBe(zh.otherNoteRequired);
    expect(translateApiError("mother sent a note", zh)).not.toBe(zh.otherNoteRequired);
  });

  it("maps month-close reconciliation mismatch to varianceNoteRequired exclusively", () => {
    const mismatchMsg =
      "A note is required when Reconciliation has a mismatch (expected: 5000 sen, actual: 4000 sen, difference: -1000 sen)";
    expect(translateApiError(mismatchMsg, zh)).toBe(zh.varianceNoteRequired);
    expect(translateApiError(mismatchMsg, en)).toBe(en.varianceNoteRequired);

    const varianceMsg = "variance detected";
    expect(translateApiError(varianceMsg, zh)).toBe(zh.varianceNoteRequired);
  });

  it("is idempotent: preserves already translated messages without falling back to saveError", () => {
    expect(translateApiError(zh.otherNoteRequired, zh)).toBe(zh.otherNoteRequired);
    expect(translateApiError(zh.varianceNoteRequired, zh)).toBe(zh.varianceNoteRequired);
    expect(translateApiError(zh.invalidAmount, zh)).toBe(zh.invalidAmount);
    expect(translateApiError(en.otherNoteRequired, en)).toBe(en.otherNoteRequired);
  });

  it("falls back to saveError for unknown or empty errors", () => {
    expect(translateApiError(null, zh)).toBe(zh.saveError);
    expect(translateApiError(undefined, zh)).toBe(zh.saveError);
    expect(translateApiError("", zh)).toBe(zh.saveError);
    expect(translateApiError("Something completely unexpected happened", zh)).toBe(zh.saveError);
  });
});
