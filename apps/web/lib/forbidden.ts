import type { AccessDecision } from "./access";

type Reason = Extract<AccessDecision, { ok: false }>["reason"];

const MESSAGES: Record<Reason, string> = {
  missing_header: "No Tailscale identity was sent with this request.",
  not_allowed: "Your Tailscale login is not on the allowlist for this dashboard.",
  dev_login_in_production: "Server misconfigured: DASHBOARD_DEV_LOGIN is set in production.",
};

const HEADERS = { "cache-control": "no-store" };

/** 403 as JSON for `/api/*`, as a small HTML page for everything else. */
export function forbiddenResponse(reason: Reason, pathname: string): Response {
  const message = MESSAGES[reason];
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return Response.json({ error: { code: "forbidden", message } }, { status: 403, headers: HEADERS });
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>403 · Traccia</title><style>:root{color-scheme:light dark}body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100dvh;margin:0}main{max-width:26rem;padding:1.5rem}h1{font-size:1.1rem;margin:0 0 .5rem}p{margin:0;opacity:.7;font-size:.9rem;line-height:1.5}</style></head><body><main><h1>Access denied</h1><p>${message}</p></main></body></html>`;
  return new Response(html, {
    status: 403,
    headers: { ...HEADERS, "content-type": "text/html; charset=utf-8" },
  });
}
