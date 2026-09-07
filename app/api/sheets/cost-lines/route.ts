import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/auth/guard";
import {
  addCostLine,
  ClosedMonthError,
  CostCategory,
  NotFoundError,
  removeCostLine,
  updateCostLine,
  ValidationError,
} from "@/services/daily-sheet";

function handleError(err: unknown): NextResponse {
  if (err instanceof ValidationError || err instanceof ClosedMonthError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof SyntaxError) {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * POST /api/sheets/cost-lines
 * Add a Cost Line to a Daily Sheet.
 */
export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }

    const sheetId = Number(body.sheetId);
    if (!Number.isInteger(sheetId) || sheetId <= 0) {
      return NextResponse.json({ error: "Valid 'sheetId' is required" }, { status: 400 });
    }

    const line = await addCostLine(
      sheetId,
      body.amountSen,
      body.category as CostCategory,
      body.note,
    );

    return NextResponse.json({ costLine: line }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
});

/**
 * PATCH /api/sheets/cost-lines
 * Update an existing Cost Line.
 */
export const PATCH = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }

    const costLineId = Number(body.costLineId);
    if (!Number.isInteger(costLineId) || costLineId <= 0) {
      return NextResponse.json({ error: "Valid 'costLineId' is required" }, { status: 400 });
    }

    const line = await updateCostLine(costLineId, {
      amountSen: body.amountSen,
      category: body.category as CostCategory,
      note: body.note,
    });

    return NextResponse.json({ costLine: line }, { status: 200 });
  } catch (err) {
    return handleError(err);
  }
});

/**
 * DELETE /api/sheets/cost-lines?id=... (or JSON body { costLineId })
 * Remove a Cost Line from a Daily Sheet.
 */
export const DELETE = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const idFromQuery = searchParams.get("id") ?? searchParams.get("costLineId");

    let costLineId: number;
    if (idFromQuery) {
      costLineId = Number(idFromQuery);
    } else {
      const body = await req.json().catch(() => ({}));
      costLineId = Number(body.costLineId);
    }

    if (!Number.isInteger(costLineId) || costLineId <= 0) {
      return NextResponse.json(
        { error: "Valid 'costLineId' or 'id' query parameter is required" },
        { status: 400 },
      );
    }

    const result = await removeCostLine(costLineId);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleError(err);
  }
});
