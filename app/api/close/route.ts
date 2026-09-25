import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/auth/guard";
import { closeMonth } from "@/services/month-close";
import { handleError } from "@/services/errors";

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

    const {
      expectedSen,
      actualSen,
      differenceSen,
      balanced,
      warning,
      ...close
    } = result;

    return NextResponse.json(
      {
        close,
        balanced,
        differenceSen: Number(differenceSen),
        expectedSen: Number(expectedSen),
        actualSen: Number(actualSen),
        ...(warning ? { warning } : {}),
      },
      { status: 201 },
    );
  } catch (err) {
    return handleError(err);
  }
});
