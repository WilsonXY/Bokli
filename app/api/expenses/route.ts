import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/auth/guard";
import {
  addOperatingExpense,
  listOperatingExpenses,
  type OperatingExpenseType,
  removeOperatingExpense,
  updateOperatingExpense,
} from "@/services/operating-expense";
import { handleError } from "@/services/errors";

/**
 * GET /api/expenses?month=YYYY-MM
 * List all Operating Expenses for a given month.
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

    const expenses = await listOperatingExpenses(month);
    return NextResponse.json({ expenses, month }, { status: 200 });
  } catch (err) {
    return handleError(err);
  }
});

/**
 * POST /api/expenses
 * Record an Operating Expense (rental, utilities, wages, other).
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

    if (!body.type || typeof body.type !== "string") {
      return NextResponse.json(
        { error: "Field 'type' is required" },
        { status: 400 },
      );
    }

    if (body.amountSen === undefined) {
      return NextResponse.json(
        { error: "Field 'amountSen' is required" },
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
 * PATCH /api/expenses?id=... (or JSON body { id })
 * Update an existing Operating Expense.
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

    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("id");
    const id = idParam ? Number(idParam) : Number(body.id);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { error: "Valid 'id' query parameter or body field is required" },
        { status: 400 },
      );
    }

    const expense = await updateOperatingExpense(id, {
      month: body.month,
      type: body.type as OperatingExpenseType | undefined,
      amountSen: body.amountSen,
      note: body.note,
    });

    return NextResponse.json({ expense }, { status: 200 });
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
        { error: "Valid 'id' query parameter or body field is required" },
        { status: 400 },
      );
    }

    const result = await removeOperatingExpense(id);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleError(err);
  }
});
