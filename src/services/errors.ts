import { NextResponse } from "next/server";
import {
  ClosedMonthError,
  FutureDateError,
  NotFoundError,
  ValidationError,
} from "./daily-sheet";
import { ForbiddenError } from "./month-close";

export {
  ClosedMonthError,
  ForbiddenError,
  FutureDateError,
  NotFoundError,
  ValidationError,
};

/**
 * Shared error handler for API routes.
 * Maps domain errors to HTTP status codes:
 * - ValidationError -> 400
 * - FutureDateError -> 400
 * - ForbiddenError -> 403
 * - NotFoundError -> 404
 * - ClosedMonthError -> 409
 * - SyntaxError -> 400
 * - Fallback -> 500 (logs error to console, returns generic message)
 */
export function handleError(err: unknown): NextResponse {
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof ClosedMonthError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof ValidationError || err instanceof FutureDateError) {
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

  console.error(err);
  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500 },
  );
}
