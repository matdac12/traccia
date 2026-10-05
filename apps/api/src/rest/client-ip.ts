import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/**
 * Client IP for rate limiting and logs. With TRUST_PROXY the app sits behind
 * exactly one proxy (`tailscale serve`), which appends the peer address to
 * X-Forwarded-For, so the last entry is the one to trust; earlier entries are
 * client-controlled.
 */
export function resolveClientIp(
  c: Context,
  trustProxy: boolean,
): string | undefined {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for");
    const last = forwarded?.split(",").at(-1)?.trim();
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined; // not running under @hono/node-server (e.g. app.request)
  }
}
