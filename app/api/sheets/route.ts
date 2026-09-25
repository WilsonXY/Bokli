import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/auth/guard";
import { getDb } from "@/db";
import * as dailySheetService from "@/services/daily-sheet";
import { getSheetWithCosts } from "@/services/daily-sheet";
import { handleError } from "@/services/errors";

function formatSheetResponse(result: NonNullable<ReturnType<typeof getSheetWithCosts>>) {
  return {
    sheet: result.sheet,
    costLines: result.costLines,
    totalCostSen: Number(result.totalCostSen),
    totalRevenueSen: Number(result.totalRevenueSen),
    grossProfitSen: Number(result.grossProfitSen),
  };
}

const LEGACY_FIELDS = ["sheetId", "category", "amountSen", "note", "action"] as const;

/**
 * POST /api/sheets
 * Save a Daily Sheet for a date: create-or-get the sheet, optionally set revenue,
 * and replace its Cost Lines with the submitted list. All-or-nothing.
 */
export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    if (!body.date || typeof body.date !== "string") {
      return NextResponse.json(
        { error: "Field 'date' is required (format: YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    if (!Array.isArray(body.costLines)) {
      return NextResponse.json(
        { error: "Field 'costLines' is required and must be an array" },
        { status: 400 },
      );
    }

    // The legacy single-line / direct-add fields are retired. Rejecting them loudly
    // beats ignoring them: a client still sending them has a bug we want surfaced.
    const strayFields = LEGACY_FIELDS.filter((f) => body[f] !== undefined);
    if (strayFields.length > 0) {
      return NextResponse.json(
        { error: `Unexpected legacy field(s): ${strayFields.join(", ")}` },
        { status: 400 },
      );
    }

    // Validate costLines fully BEFORE setRevenue so a bad line cannot persist revenue.
    dailySheetService.validateCostLines(body.costLines);

    const { db } = getDb();

    // Single drizzle db.transaction wrapping create-or-get sheet + setRevenue + replaceCostLines so POST is all-or-nothing
    const sheet = db.transaction((tx) => {
      const currentSheet = dailySheetService.getOrCreateSheet(body.date, { db: tx });

      // Optional revenue setup
      if (body.cashSen !== undefined || body.tngSen !== undefined) {
        const cash = body.cashSen !== undefined ? body.cashSen : currentSheet.cashSen;
        const tng = body.tngSen !== undefined ? body.tngSen : currentSheet.tngSen;
        dailySheetService.setRevenue(currentSheet.id, cash, tng, { db: tx });
      }

      dailySheetService.replaceCostLines(currentSheet.id, body.costLines, { db: tx });

      return currentSheet;
    });

    const withCosts = dailySheetService.getSheetWithCosts(body.date, { db });
    if (!withCosts) {
      return NextResponse.json({ sheet }, { status: 201 });
    }

    return NextResponse.json(formatSheetResponse(withCosts), { status: 201 });
  } catch (err) {
    return handleError(err);
  }
});
