import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/auth/guard";
import {
  addOperatingExpense,
  type OperatingExpenseType,
  removeOperatingExpense,
} from "@/services/operating-expense";
import { handleError } from "@/services/errors";

/**
 * POST /api/expenses
 * Record an Operating Expense (rental, utilities, wages, other).
 */
export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Request body must be a JSON object", code: "saveError" },
        { status: 400 },
      );
    }

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

    const expense = await addOperatingExpense(
      body.month,
      body.type as OperatingExpenseType,
      body.amountSen,
      body.note,
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

    let id: number;
    if (idParam) {
      id = Number(idParam);
    } else {
      const body = await req.json().catch(() => ({}));
      id = Number(body.id);
    }

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        {
          error: "Valid 'id' query parameter or body field is required",
          code: "saveError",
        },
        { status: 400 },
      );
    }

    const result = await removeOperatingExpense(id);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleError(err);
  }
});
