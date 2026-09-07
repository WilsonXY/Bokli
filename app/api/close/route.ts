import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/auth/guard";
import {
  closeMonth,
  ClosedMonthError,
  ForbiddenError,
  FutureDateError,
  getClose,
  listCloses,
  NotFoundError,
  ValidationError,
} from "@/services/month-close";

function handleError(err: unknown): NextResponse {
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (
    err instanceof ValidationError ||
    err instanceof FutureDateError ||
    err instanceof ClosedMonthError
  ) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof SyntaxError) {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * GET /api/close?month=YYYY-MM or GET /api/close
 * If month is provided: get close snapshot + reconciliation for that month.
 * If month is omitted: list close history for all closed months with diffs.
 */
export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month");

    if (month) {
      const result = await getClose(month);
      if (!result) {
        return NextResponse.json(
          { error: `Month close not found for month: ${month}` },
          { status: 404 },
        );
      }

      return NextResponse.json(
        {
          close: result.close,
          balanced: result.balanced,
          differenceSen: Number(result.differenceSen),
          expectedSen: Number(result.expectedSen),
          actualSen: Number(result.actualSen),
          ...(result.warning ? { warning: result.warning } : {}),
        },
        { status: 200 },
      );
    }

    const closes = await listCloses();
    return NextResponse.json(
      {
        closes: closes.map((c) => ({
          ...c,
          differenceSen: Number(c.differenceSen),
          expectedSen: Number(c.expectedSen),
          actualSen: Number(c.actualSen),
        })),
      },
      { status: 200 },
    );
  } catch (err) {
    return handleError(err);
  }
});

/**
 * POST /api/close
 * Close a month with snapshot + reconciliation inputs.
 * - Cash and TnG on hand
 * - Warn-only mismatch, note required on mismatch
 * - confirmEmpty required if month has zero daily sheets
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

    if (!body.month || typeof body.month !== "string") {
      return NextResponse.json(
        { error: "Field 'month' is required (format: YYYY-MM)" },
        { status: 400 },
      );
    }

    if (body.cashOnHandSen === undefined) {
      return NextResponse.json(
        { error: "Field 'cashOnHandSen' is required" },
        { status: 400 },
      );
    }

    if (body.tngOnHandSen === undefined) {
      return NextResponse.json(
        { error: "Field 'tngOnHandSen' is required" },
        { status: 400 },
      );
    }

    const result = await closeMonth(
      body.month,
      body.cashOnHandSen,
      body.tngOnHandSen,
      body.note,
      { confirmEmpty: Boolean(body.confirmEmpty) },
    );

    return NextResponse.json(
      {
        close: result.close,
        balanced: result.balanced,
        differenceSen: Number(result.differenceSen),
        expectedSen: Number(result.expectedSen),
        actualSen: Number(result.actualSen),
        ...(result.warning ? { warning: result.warning } : {}),
      },
      { status: 201 },
    );
  } catch (err) {
    return handleError(err);
  }
});
