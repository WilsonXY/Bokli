import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/auth/guard";
import { closeMonth } from "@/services/month-close";
import { handleError } from "@/services/errors";
import { parseJsonBody } from "@/lib/parse";

/**
 * POST /api/close
 * Close a month with snapshot + reconciliation inputs.
 * - Cash and TnG on hand
 * - Warn-only mismatch, note required on mismatch
 * - confirmEmpty required if month has zero daily sheets
 */
export const POST = withAuth(async (req: NextRequest) => {
  try {
    const parsed = await parseJsonBody(req);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error, code: parsed.code },
        { status: parsed.status },
      );
    }
    const body = parsed.body;

    if (!body.month || typeof body.month !== "string") {
      return NextResponse.json(
        {
          error: "Field 'month' is required (format: YYYY-MM)",
          code: "saveError",
        },
        { status: 400 },
      );
    }

    if (body.cashOnHandSen === undefined) {
      return NextResponse.json(
        { error: "Field 'cashOnHandSen' is required", code: "saveError" },
        { status: 400 },
      );
    }

    if (body.tngOnHandSen === undefined) {
      return NextResponse.json(
        { error: "Field 'tngOnHandSen' is required", code: "saveError" },
        { status: 400 },
      );
    }

    // Amount and note shapes are validated by the service.
    const result = await closeMonth(
      body.month,
      body.cashOnHandSen as number | bigint,
      body.tngOnHandSen as number | bigint,
      body.note as string | null | undefined,
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
