import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/auth/guard";
import {
  ClosedMonthError,
  getMonthPreview,
  NotFoundError,
  ValidationError,
} from "@/services/operating-expense";

function handleError(err: unknown): NextResponse {
  if (err instanceof ValidationError || err instanceof ClosedMonthError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * GET /api/preview?month=YYYY-MM
 * Live month preview:
 * - revenueSen: Cash Revenue + TnG Revenue for all Daily Sheets in month
 * - dailyCostSen: Daily Costs for all Daily Sheets in month
 * - grossSen: Gross Profit (revenueSen - dailyCostSen)
 * - operatingSen: Operating Expenses for month
 * - netSen: Net Profit (grossSen - operatingSen)
 * All integer sen.
 */
export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month");

    if (!month) {
      return NextResponse.json(
        { error: "Query parameter 'month' is required (format: YYYY-MM)" },
        { status: 400 },
      );
    }

    const preview = await getMonthPreview(month);

    return NextResponse.json(
      {
        month: preview.month,
        revenueSen: Number(preview.revenueSen),
        dailyCostSen: Number(preview.dailyCostSen),
        grossSen: Number(preview.grossSen),
        operatingSen: Number(preview.operatingSen),
        netSen: Number(preview.netSen),
      },
      { status: 200 },
    );
  } catch (err) {
    return handleError(err);
  }
});
