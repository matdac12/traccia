import "server-only";
import { headers } from "next/headers";
import { LOGIN_HEADER } from "./access";
import { serverEnv } from "./server-env";

/** The Tailscale login of the current request (already allowlisted by `proxy.ts`). */
export async function currentLogin(): Promise<string> {
  const h = await headers();
  return h.get(LOGIN_HEADER)?.trim() || serverEnv().access.devLogin || "unknown";
}
