/**
 * Next.js edge middleware.
 * - /admin/* and /dashboard require a valid NextAuth session (OIDC/SSO).
 * - /api/cron/* is intentionally left out of matchers — it uses CRON_SECRET (M2M).
 * - /api/admin/* is intentionally left out — it accepts both session + ADMIN_API_TOKEN.
 */
import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth(function middleware(req) {
  const { pathname } = req.nextUrl;

  // Allow the auth callback flow through unconditionally
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const session = req.auth;

  const requiresSession =
    pathname.startsWith("/admin") || pathname.startsWith("/dashboard");

  if (requiresSession && !session) {
    const loginUrl = new URL("/api/auth/signin", req.url);
    loginUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/admin/:path*",
    "/dashboard/:path*",
    // Exclude static assets, Next internals, cron, and API token routes from middleware
    "/((?!_next/static|_next/image|favicon.ico|api/cron|api/auth).*)",
  ],
};
