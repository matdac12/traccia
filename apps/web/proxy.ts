import { type NextRequest, NextResponse } from "next/server";
import { accessConfigFromEnv, checkAccess, LOGIN_HEADER } from "./lib/access";
import { forbiddenResponse } from "./lib/forbidden";

/**
 * Access check on EVERY route: pages, server actions, route handlers and `/api/*`
 * (the matcher excludes nothing). See `lib/access.ts` for why the identity header can
 * be trusted here. Next.js 16 calls this file `proxy` (formerly `middleware`).
 */
export function proxy(request: NextRequest) {
  const decision = checkAccess(
    request.headers.get(LOGIN_HEADER),
    accessConfigFromEnv(process.env),
  );
  if (!decision.ok) {
    return forbiddenResponse(decision.reason, request.nextUrl.pathname);
  }
  return NextResponse.next();
}

export const config = { matcher: "/:path*" };
