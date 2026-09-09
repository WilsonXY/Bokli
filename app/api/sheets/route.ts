import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/auth/guard";
import {
  addCostLine,
  CostCategory,
  getOrCreateSheet,
  getSheetByDate,
  getSheetWithCosts,
  removeCostLine,
  replaceCostLines,
  setRevenue,
  updateCostLine,
} from "@/services/daily-sheet";
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

/**
 * GET /api/sheets?date=YYYY-MM-DD
 * Retrieves a Daily Sheet with its Cost Lines and computed totals.
 */
export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");

    if (!date) {
      return NextResponse.json(
        { error: "Query parameter 'date' is required (format: YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    const result = getSheetWithCosts(date);
    if (!result) {
      return NextResponse.json(
        { error: `Daily Sheet not found for date: ${date}` },
        { status: 404 },
      );
    }

    return NextResponse.json(formatSheetResponse(result), { status: 200 });
  } catch (err) {
    return handleError(err);
  }
});

/**
 * POST /api/sheets
 * Create / ensure a Daily Sheet for a date, optionally setting revenue or adding/replacing cost lines.
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

    // Direct-insert path: append-only single-line add (via sheetId + category + amountSen, or action: "addCostLine").
    // Hardening: To ensure the sheet-save flow (which specifies 'date' and optional 'costLines' array) cannot
    // accidentally trigger this single-line append branch, we only enter this branch if action is explicitly
    // "addCostLine" OR if sheetId + category + amountSen are provided WITHOUT sheet-save fields (no 'date' and no 'costLines').
    const isDirectAddCostLine =
      body.action === "addCostLine" ||
      (!body.date && !Array.isArray(body.costLines) && body.sheetId !== undefined && body.category !== undefined && body.amountSen !== undefined);

    if (isDirectAddCostLine) {
      const sheetId = Number(body.sheetId);
      if (!Number.isInteger(sheetId) || sheetId <= 0) {
        return NextResponse.json({ error: "Valid sheetId is required" }, { status: 400 });
      }
      const line = addCostLine(
        sheetId,
        body.amountSen,
        body.category as CostCategory,
        body.note,
      );
      return NextResponse.json({ costLine: line }, { status: 201 });
    }

    // Standard sheet creation / lookup by date
    if (!body.date || typeof body.date !== "string") {
      return NextResponse.json(
        { error: "Field 'date' is required (format: YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    const sheet = getOrCreateSheet(body.date);

    // Optional revenue setup
    if (body.cashSen !== undefined || body.tngSen !== undefined) {
      const cash = body.cashSen !== undefined ? body.cashSen : sheet.cashSen;
      const tng = body.tngSen !== undefined ? body.tngSen : sheet.tngSen;
      setRevenue(sheet.id, cash, tng);
    }

    // Cost lines replacement / addition:
    // When body.costLines is an array, call replaceCostLines instead of looping addCostLine (idempotent re-save).
    if (Array.isArray(body.costLines)) {
      replaceCostLines(sheet.id, body.costLines);
    } else if (body.amountSen !== undefined && body.category) {
      addCostLine(
        sheet.id,
        body.amountSen,
        body.category as CostCategory,
        body.note,
      );
    }

    const withCosts = getSheetWithCosts(body.date);
    if (!withCosts) {
      return NextResponse.json({ sheet }, { status: 201 });
    }

    return NextResponse.json(formatSheetResponse(withCosts), { status: 201 });
  } catch (err) {
    return handleError(err);
  }
});

/**
 * PATCH /api/sheets
 * Update sheet revenue, or update/remove a Cost Line.
 */
export const PATCH = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    // Cost line removal
    if (body.action === "removeCostLine" || (body.costLineId && body.remove === true)) {
      const costLineId = Number(body.costLineId);
      if (!Number.isInteger(costLineId) || costLineId <= 0) {
        return NextResponse.json({ error: "Valid costLineId is required" }, { status: 400 });
      }
      const result = removeCostLine(costLineId);
      return NextResponse.json(result, { status: 200 });
    }

    // Cost line update
    if (body.action === "updateCostLine" || (body.costLineId && (body.amountSen !== undefined || body.category !== undefined || body.note !== undefined))) {
      const costLineId = Number(body.costLineId);
      if (!Number.isInteger(costLineId) || costLineId <= 0) {
        return NextResponse.json({ error: "Valid costLineId is required" }, { status: 400 });
      }
      const updated = updateCostLine(costLineId, {
        amountSen: body.amountSen,
        category: body.category as CostCategory,
        note: body.note,
      });
      return NextResponse.json({ costLine: updated }, { status: 200 });
    }

    // Revenue update
    let targetSheetId: number | null = null;
    if (body.sheetId !== undefined) {
      targetSheetId = Number(body.sheetId);
    } else if (body.date && typeof body.date === "string") {
      const s = getSheetByDate(body.date);
      if (!s) {
        return NextResponse.json(
          { error: `Daily Sheet not found for date: ${body.date}` },
          { status: 404 },
        );
      }
      targetSheetId = s.id;
    }

    if (targetSheetId === null || !Number.isInteger(targetSheetId) || targetSheetId <= 0) {
      return NextResponse.json(
        { error: "Either valid 'sheetId' or 'date' is required for updating revenue" },
        { status: 400 },
      );
    }

    if (body.cashSen === undefined || body.tngSen === undefined) {
      return NextResponse.json(
        { error: "Both 'cashSen' and 'tngSen' are required to set revenue" },
        { status: 400 },
      );
    }

    const updatedSheet = setRevenue(targetSheetId, body.cashSen, body.tngSen);
    const withCosts = getSheetWithCosts(updatedSheet.date);

    return NextResponse.json(
      withCosts ? formatSheetResponse(withCosts) : { sheet: updatedSheet },
      { status: 200 },
    );
  } catch (err) {
    return handleError(err);
  }
});

/**
 * DELETE /api/sheets is rejected because Daily Sheets cannot be hard deleted.
 */
export const DELETE = withAuth(async () => {
  return NextResponse.json(
    { error: "Daily Sheets cannot be deleted (corrections keep timestamps, no hard delete)" },
    { status: 405 },
  );
});
