import { NextResponse } from "next/server";

/**
 * Domain error classes.
 *
 * This module is a leaf: it must not import from any service module, so that
 * importing an error class never pulls the DB layer into the client/UI import
 * graph.
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ClosedMonthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClosedMonthError";
  }
}

export class FutureDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FutureDateError";
  }
}

export class ForbiddenError extends Error {
  constructor(
    message: string = "Forbidden: Admin role required to reopen a closed month",
  ) {
    super(message);
    this.name = "ForbiddenError";
  }
}

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
