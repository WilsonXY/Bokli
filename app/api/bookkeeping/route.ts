import { NextResponse } from "next/server";
import { withAuth } from "@/auth/guard";

export const GET = withAuth(async (_req, session) => {
  return NextResponse.json({
    ok: true,
    message: "Bookkeeping API access granted",
    user: session.user,
  });
});
