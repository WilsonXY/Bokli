import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/auth/guard";
import {
  addOperatingExpense,
  type OperatingExpenseType,
  removeOperatingExpense,
} from "@/services/operating-expense";
import { handleError } from "@/services/errors";
import { parseJsonBody, parsePositiveId } from "@/lib/parse";

/**
 * POST /api/expenses
 * Record an Operating Expense (rental, utilities, wages, other).
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

    if (!body.type || typeof body.type !== "string") {
      return NextResponse.json(
        { error: "Field 'type' is required", code: "saveError" },
        { status: 400 },
      );
    }

    if (body.amountSen === undefined) {
      return NextResponse.json(
        { error: "Field 'amountSen' is required", code: "saveError" },
        { status: 400 },
      );
    }

    // Type, amount and note shapes are validated by the service.
    const expense = await addOperatingExpense(
      body.month,
      body.type as OperatingExpenseType,
      body.amountSen as number | bigint,
      body.note as string | null | undefined,
    );

    return NextResponse.json(
      { expense, merged: expense.merged },
      { status: expense.merged ? 200 : 201 },
    );
  } catch (err) {
    return handleError(err);
  }
});

/**
 * DELETE /api/expenses?id=... (or JSON body { id })
 * Remove an Operating Expense.
 */
export const DELETE = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("id");

    let rawId: unknown = idParam;
    if (!idParam) {
      // A missing or malformed body just means "no id" — except an oversize one.
      const parsed = await parseJsonBody(req);
      if (!parsed.ok && parsed.status === 413) {
        return NextResponse.json(
          { error: parsed.error, code: parsed.code },
          { status: parsed.status },
        );
      }
      rawId = parsed.ok ? parsed.body.id : undefined;
    }

    const id = parsePositiveId(rawId, "'id' query parameter or body field");
    if (!id.ok) {
      return NextResponse.json(
        { error: id.error, code: id.code },
        { status: 400 },
      );
    }

    const result = await removeOperatingExpense(id.id);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleError(err);
  }
});
