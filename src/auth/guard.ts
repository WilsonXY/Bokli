import { NextResponse, NextRequest } from "next/server";
import { auth, handlers } from "./index";

export interface SessionUser {
  id?: string;
  name?: string | null;
  role?: string | null;
  username?: string | null;
}

export interface AuthSession {
  user?: SessionUser;
  expires?: string;
}

/**
 * A request that an upstream `auth()` wrapper has already annotated with the
 * decoded session, so it does not have to be resolved from the cookie again.
 */
export type AuthedRequest = NextRequest & { auth?: AuthSession | null };

/**
 * Checks if a request path should be protected.
 * All /api/* paths are protected except /api/auth/* endpoints.
 */
export function isProtectedApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/") && !pathname.startsWith("/api/auth");
}

/**
 * Resolves the session for a request: an already-attached `req.auth` wins,
 * otherwise the session cookie is decoded via the NextAuth session endpoint.
 * Returns null when the request carries no session at all.
 */
export async function resolveSession(
  req: Request | NextRequest,
): Promise<AuthSession | null> {
  const attached = (req as AuthedRequest).auth;
  if (attached) {
    return attached;
  }

  const cookie = req.headers.get("cookie");
  if (!cookie) {
    return null;
  }

  const url = new URL(req.url);
  const sessionUrl = new URL("/api/auth/session", req.url).toString();
  const sessionReq = new NextRequest(sessionUrl, {
    headers: {
      cookie,
      "x-forwarded-proto": req.headers.get("x-forwarded-proto") ?? "http",
      host: req.headers.get("host") ?? url.host,
    },
  });

  const sessionRes = await handlers.GET(sessionReq);
  if (!sessionRes.ok) {
    return null;
  }

  const data = await sessionRes.json();
  if (data && data.user) {
    return data as AuthSession;
  }

  return null;
}

/**
 * Service-level auth guard.
 * Given a request (and optional session override for testing or manual invocations),
 * verifies authorization. Returns a 401 JSON Response if unauthorized, or null if allowed.
 */
export async function authGuard(
  req: Request | NextRequest,
  sessionOverride?: AuthSession | null,
): Promise<Response | null> {
  const url = new URL(req.url);
  if (!isProtectedApiPath(url.pathname)) {
    return null;
  }

  const session =
    sessionOverride !== undefined ? sessionOverride : await resolveSession(req);

  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Route handler wrapper to enforce authentication on API routes.
 * The session is resolved exactly once and handed to the handler; the handler
 * never runs without an authenticated user.
 */
export function withAuth<T extends Request = NextRequest>(
  handler: (req: T, session: AuthSession) => Promise<Response> | Response,
) {
  return async (req: T): Promise<Response> => {
    const session = await resolveSession(req);

    const guardRes = await authGuard(req, session);
    if (guardRes) {
      return guardRes;
    }

    // Reachable only for non-protected paths, where authGuard abstains.
    // The handler still requires an authenticated user.
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return handler(req, session);
  };
}
