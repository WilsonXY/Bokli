import { NextRequest, NextResponse } from "next/server";
import { type AuthSession, withAuth } from "@/auth/guard";
import {
  ClosedMonthError,
  ForbiddenError,
  FutureDateError,
  NotFoundError,
  reopenMonth,
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
 * POST /api/close/reopen
 * Reopen a closed month with reason.
 * ADMIN ONLY — reject Operator with 403 Forbidden.
 */
export const POST = withAuth(
  async (req: NextRequest, session: AuthSession) => {
    try {
      if (session.user?.role !== "Admin") {
        return NextResponse.json(
          {
            error: "Forbidden: Admin role required to reopen a closed month",
          },
          { status: 403 },
        );
      }

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

      if (
        body.reason === undefined ||
        typeof body.reason !== "string" ||
        !body.reason.trim()
      ) {
        return NextResponse.json(
          { error: "Field 'reason' is required to reopen a closed month" },
          { status: 400 },
        );
      }

      const updatedClose = await reopenMonth(
        body.month,
        body.reason,
        session.user.role,
      );

      return NextResponse.json(
        {
          close: updatedClose,
          message: `Month "${body.month}" successfully reopened`,
        },
        { status: 200 },
      );
    } catch (err) {
      return handleError(err);
    }
  },
);
