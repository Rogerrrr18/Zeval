/**
 * @fileoverview Next.js edge middleware: inject active project ID header for all API routes.
 *
 * The browser stores the active project in a cookie (zeval-project-id).
 * This middleware reads it and forwards it as x-zeval-project-id so every
 * API route sees the correct project context without any component changes.
 */

import { type NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "zeval-project-id";
const HEADER_NAME = "x-zeval-project-id";

export function middleware(request: NextRequest) {
  const projectId = request.cookies.get(COOKIE_NAME)?.value;
  if (!projectId) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(HEADER_NAME, projectId);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: "/api/:path*",
};
