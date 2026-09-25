import { NextRequest, NextResponse } from "next/server";
import { type AuthSession, withAuth } from "@/auth/guard";
import { reopenMonth } from "@/services/month-close";
import { handleError } from "@/services/errors";
import { parseJsonBody } from "@/lib/parse";

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
            code: "forbidden",
          },
          { status: 403 },
        );
      }

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

      if (
        body.reason === undefined ||
        typeof body.reason !== "string" ||
        !body.reason.trim()
      ) {
        return NextResponse.json(
          {
            error: "Field 'reason' is required to reopen a closed month",
            code: "reopenReasonRequired",
          },
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
