import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth/config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const pathname = req.nextUrl.pathname;
  const isLoggedIn = !!req.auth;

  // 1. API routes handling
  if (pathname.startsWith("/api/")) {
    if (pathname.startsWith("/api/auth")) {
      return NextResponse.next();
    }
    if (!isLoggedIn) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // 2. Allow login page or redirect to home if already logged in
  if (pathname === "/login") {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }
    return NextResponse.next();
  }

  // 3. Protect all other pages: redirect anonymous visitors to /login
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public image assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
