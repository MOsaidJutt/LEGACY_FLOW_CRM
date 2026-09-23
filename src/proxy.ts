import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * Cheap gate only: bounce requests without a session cookie to /login.
 * Real authentication and role checks happen in every page, route handler and
 * server action (see lib/auth/session.ts), never here alone.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const { pathname, search } = request.nextUrl;

  if (!hasSession && pathname !== "/login") {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // everything except API routes (they authenticate themselves), Next internals and static assets
    "/((?!api|_next/static|_next/image|brand|icon.png|apple-icon.png|favicon.ico|robots.txt).*)",
  ],
};
