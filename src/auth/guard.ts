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
 * Checks if a request path should be protected.
 * All /api/* paths are protected except /api/auth/* endpoints.
 */
export function isProtectedApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/") && !pathname.startsWith("/api/auth");
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

  let session: AuthSession | null = null;
  if (sessionOverride !== undefined) {
    session = sessionOverride;
  } else if ((req as any).auth) {
    session = (req as any).auth;
  } else {
    const cookie = req.headers.get("cookie");
    if (cookie) {
      const sessionUrl = new URL("/api/auth/session", req.url).toString();
      const sessionReq = new NextRequest(sessionUrl, {
        headers: {
          cookie,
          "x-forwarded-proto": req.headers.get("x-forwarded-proto") ?? "http",
          host: req.headers.get("host") ?? url.host,
        },
      });
      const sessionRes = await handlers.GET(sessionReq);
      if (sessionRes.ok) {
        const data = await sessionRes.json();
        if (data && data.user) {
          session = data as AuthSession;
        }
      }
    }
  }

  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Route handler wrapper to enforce authentication on API routes.
 */
export function withAuth<T extends Request = NextRequest>(
  handler: (req: T, session: AuthSession) => Promise<Response> | Response,
) {
  return async (req: T): Promise<Response> => {
    const guardRes = await authGuard(req);
    if (guardRes) {
      return guardRes;
    }

    // Retrieve authenticated session for handler
    let session: AuthSession = { user: (req as any).auth?.user };
    if (!session.user) {
      const cookie = req.headers.get("cookie");
      if (cookie) {
        const sessionUrl = new URL("/api/auth/session", req.url).toString();
        const sessionReq = new NextRequest(sessionUrl, {
          headers: {
            cookie,
            "x-forwarded-proto": req.headers.get("x-forwarded-proto") ?? "http",
            host: req.headers.get("host") ?? new URL(req.url).host,
          },
        });
        const res = await handlers.GET(sessionReq);
        if (res.ok) {
          session = (await res.json()) as AuthSession;
        }
      }
    }

    return handler(req, session);
  };
}
