import { createHash } from "node:crypto";
import { resolve } from "node:path";

/**
 * Local e2e ports. The Playwright config and the stack must agree on one value, and parallel
 * worktree checkouts (one per agent thread) must not fight over the same port, so each checkout
 * derives a stable slot from its own path: same checkout → same ports, different checkout →
 * different ports. Override with E2E_WEB_PORT / E2E_API_PORT when even that collides.
 */
function portFor(base: number, slots: number, tag: string): number {
  const checkout = resolve(__dirname, "../../../..");
  const digest = createHash("sha1").update(`${tag}:${checkout}`).digest();
  return base + (digest.readUInt16BE(0) % slots);
}

export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? portFor(3100, 900, "web"));
export const API_PORT = Number(process.env.E2E_API_PORT ?? portFor(8800, 900, "api"));
/** The dashboard allowlist (ADR 0008) accepts exactly this login; the browser sends it as the identity header. */
export const E2E_LOGIN = "e2e@local";
export const LOGIN_HEADER = "Tailscale-User-Login";
export const PROJECT_NAME = "Smoke Project";
