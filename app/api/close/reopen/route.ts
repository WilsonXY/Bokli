import { NextRequest, NextResponse } from "next/server";
import { type AuthSession, withAuth } from "@/auth/guard";
import { reopenMonth } from "@/services/month-close";
import { handleError } from "@/services/errors";

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
        { role: session.user.role },
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
