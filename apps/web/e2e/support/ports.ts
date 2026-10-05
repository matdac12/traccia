/** Fixed local ports so the Playwright config and the workers agree; override when they clash. */
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
export const API_PORT = Number(process.env.E2E_API_PORT ?? 8799);
/** The dashboard allowlist (ADR 0008) accepts exactly this login; the browser sends it as the identity header. */
export const E2E_LOGIN = "e2e@local";
export const LOGIN_HEADER = "Tailscale-User-Login";
export const PROJECT_NAME = "Smoke Project";
