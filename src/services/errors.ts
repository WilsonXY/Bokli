import { NextResponse } from "next/server";

/**
 * Domain error classes.
 *
 * This module is a leaf: it must not import from any service module, so that
 * importing an error class never pulls the DB layer into the client/UI import
 * graph.
 */

/**
 * Stable, machine-readable error codes: the API error protocol.
 *
 * These are the contract between the services/API and the client's
 * `translateApiError` — English prose messages are for logs and for legacy
 * fallback only, never for matching. The set is closed and mirrors the existing
 * user-facing i18n cases; do not add a code without one behind it. `notFound`
 * and `futureDate` are the exceptions: they exist so the server can be precise,
 * but the client deliberately renders them as the generic save error.
 */
export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "monthClosed"
  | "network"
  | "rateLimited"
  | "otherNoteRequired"
  | "varianceNoteRequired"
  | "reopenReasonRequired"
  | "invalidAmount"
  | "notFound"
  | "futureDate"
  | "saveError";

/**
 * Base class for domain errors that carry a stable `code`.
 * Every subclass takes `(message, code?)` and supplies its own default code,
 * so a throw site only names a code when it means something more specific.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;

  constructor(message: string, code: ApiErrorCode) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code: ApiErrorCode = "saveError") {
    super(message, code);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code: ApiErrorCode = "notFound") {
    super(message, code);
    this.name = "NotFoundError";
  }
}

export class ClosedMonthError extends AppError {
  constructor(message: string, code: ApiErrorCode = "monthClosed") {
    super(message, code);
    this.name = "ClosedMonthError";
  }
}

export class FutureDateError extends AppError {
  constructor(message: string, code: ApiErrorCode = "futureDate") {
    super(message, code);
    this.name = "FutureDateError";
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message: string = "Forbidden: Admin role required to reopen a closed month",
    code: ApiErrorCode = "forbidden",
  ) {
    super(message, code);
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
 *
 * The body is always `{ error, code }`: `code` is what the client translates,
 * `error` stays English prose for logs and for the client's legacy fallback.
 */
export function handleError(err: unknown): NextResponse {
  if (err instanceof ForbiddenError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: 403 },
    );
  }
  if (err instanceof ClosedMonthError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: 409 },
    );
  }
  if (err instanceof ValidationError || err instanceof FutureDateError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: 400 },
    );
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: 404 },
    );
  }
  if (err instanceof SyntaxError) {
    return NextResponse.json(
      { error: "Invalid JSON in request body", code: "saveError" },
      { status: 400 },
    );
  }

  console.error(err);
  return NextResponse.json(
    { error: "Internal server error", code: "saveError" },
    { status: 500 },
  );
}
