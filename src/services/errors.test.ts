import { describe, it, expect } from "vitest";
import {
  ClosedMonthError,
  ForbiddenError,
  FutureDateError,
  NotFoundError,
  ValidationError,
  handleError,
  type ApiErrorCode,
} from "./errors";
import {
  API_ERROR_CODE_TO_KEY,
  DICTIONARY,
  translateApiError,
} from "@/lib/i18n";

const zh = DICTIONARY.zh;
const en = DICTIONARY.en;

/**
 * The API error protocol: services attach a stable `code`, handleError ships it,
 * and the client translates the code — never the English prose.
 */
describe("error codes: code -> i18n key mapping record", () => {
  const cases: Array<[ApiErrorCode, keyof typeof zh]> = [
    ["unauthorized", "unauthorizedError"],
    ["forbidden", "forbiddenError"],
    ["monthClosed", "monthClosedError"],
    ["network", "networkError"],
    ["rateLimited", "loginRateLimited"],
    ["otherNoteRequired", "otherNoteRequired"],
    ["varianceNoteRequired", "varianceNoteRequired"],
    ["reopenReasonRequired", "reopenReasonRequired"],
    ["invalidAmount", "invalidAmount"],
    // No dedicated user-facing case: these fall back to the generic save error.
    ["notFound", "saveError"],
    ["futureDate", "saveError"],
    ["saveError", "saveError"],
  ];

  for (const [code, key] of cases) {
    it(`maps code "${code}" to i18n key "${key}"`, () => {
      expect(API_ERROR_CODE_TO_KEY[code]).toBe(key);
      expect(translateApiError({ code }, zh)).toBe(zh[key]);
      expect(translateApiError({ code }, en)).toBe(en[key]);
    });
  }

  it("falls back to saveError for an unknown code", () => {
    expect(translateApiError({ code: "nonsense" }, zh)).toBe(zh.saveError);
  });

  it("prefers the code over prose that would match a different case", () => {
    // Prose says "closed" (would match monthClosedError); the code wins.
    expect(
      translateApiError(
        {
          error: "A reason is required to reopen a closed month",
          code: "reopenReasonRequired",
        },
        zh,
      ),
    ).toBe(zh.reopenReasonRequired);
  });

  it("still substring-matches codeless prose (legacy fallback)", () => {
    expect(translateApiError("Unauthorized", zh)).toBe(zh.unauthorizedError);
    expect(translateApiError({ error: "Unauthorized" }, zh)).toBe(
      zh.unauthorizedError,
    );
    expect(translateApiError("Request body must be a JSON object", zh)).toBe(
      zh.saveError,
    );
  });

  it("returns saveError for an empty or missing error", () => {
    expect(translateApiError(undefined, zh)).toBe(zh.saveError);
    expect(translateApiError(null, zh)).toBe(zh.saveError);
    expect(translateApiError("", zh)).toBe(zh.saveError);
    expect(translateApiError({}, zh)).toBe(zh.saveError);
  });
});

describe("domain error classes carry a default code", () => {
  it("defaults per class", () => {
    expect(new ValidationError("nope").code).toBe("saveError");
    expect(new NotFoundError("nope").code).toBe("notFound");
    expect(new ClosedMonthError("nope").code).toBe("monthClosed");
    expect(new FutureDateError("nope").code).toBe("futureDate");
    expect(new ForbiddenError().code).toBe("forbidden");
  });

  it("lets a throw site override the code for a specific semantic case", () => {
    expect(
      new ValidationError("Note is required...", "otherNoteRequired").code,
    ).toBe("otherNoteRequired");
  });
});

describe("handleError response bodies carry status + code", () => {
  const cases: Array<[string, Error, number, ApiErrorCode]> = [
    ["ForbiddenError", new ForbiddenError(), 403, "forbidden"],
    ["ClosedMonthError", new ClosedMonthError("closed"), 409, "monthClosed"],
    ["ValidationError", new ValidationError("bad"), 400, "saveError"],
    ["FutureDateError", new FutureDateError("future"), 400, "futureDate"],
    ["NotFoundError", new NotFoundError("missing"), 404, "notFound"],
    ["SyntaxError", new SyntaxError("bad json"), 400, "saveError"],
  ];

  for (const [name, err, status, code] of cases) {
    it(`${name} -> ${status} with code "${code}"`, async () => {
      const res = handleError(err);
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body.code).toBe(code);
      // The English message stays for logs and the legacy fallback.
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);
    });
  }

  it("keeps the coded ValidationError code through the response", async () => {
    const res = handleError(
      new ValidationError(
        "Note is required when Operating Expense type is 'other'",
        "otherNoteRequired",
      ),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("otherNoteRequired");
  });
});

/**
 * Regression (WS4 zh bug): an Operating Expense "other"-category missing-note
 * error used to be substring-matched to the Reconciliation VARIANCE message,
 * because both English strings contain "note is required". With the structured
 * code it can no longer collide.
 */
describe("regression: opex 'other' note error is not the variance message", () => {
  const opexErr = new ValidationError(
    "Note is required when Operating Expense type is 'other'",
    "otherNoteRequired",
  );

  it("maps to otherNoteRequired via the structured path, in zh", async () => {
    const body = await handleError(opexErr).json();
    expect(translateApiError(body, zh)).toBe(zh.otherNoteRequired);
    expect(translateApiError(body, zh)).not.toBe(zh.varianceNoteRequired);
  });

  it("maps to otherNoteRequired via the structured path, in en", async () => {
    const body = await handleError(opexErr).json();
    expect(translateApiError(body, en)).toBe(en.otherNoteRequired);
    expect(translateApiError(body, en)).not.toBe(en.varianceNoteRequired);
  });

  it("the prose alone would have collided with varianceNoteRequired", () => {
    // Documents exactly what the code protocol fixes: the codeless fallback
    // still mis-routes this English prose.
    expect(translateApiError(opexErr.message, zh)).toBe(
      zh.varianceNoteRequired,
    );
  });

  it("the month-close variance error still maps to varianceNoteRequired", async () => {
    const body = await handleError(
      new ValidationError(
        "A note is required when Reconciliation has a mismatch (expected: 1 sen, actual: 2 sen, difference: 1 sen)",
        "varianceNoteRequired",
      ),
    ).json();
    expect(translateApiError(body, zh)).toBe(zh.varianceNoteRequired);
  });
});
