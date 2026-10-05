/**
 * Dashboard access check (ADR 0008): the identity header `Tailscale-User-Login`
 * is compared with the `DASHBOARD_ALLOWED_LOGINS` allowlist.
 *
 * SECURITY: this is only valid because the web service listens on localhost behind
 * `tailscale serve`, which sets (and overwrites) the header. Anything that can reach
 * the port directly, including another local process on the host, can forge it. We
 * accept that for v1 (ADR 0008). Never publish this port outside `tailscale serve`.
 *
 * Pure functions, no I/O: the proxy (`proxy.ts`) wires them to requests and env.
 */

export const LOGIN_HEADER = "tailscale-user-login";

export type AccessConfig = {
  allowedLogins: readonly string[];
  /** Local development only; refused when `production` is true. */
  devLogin?: string;
  production: boolean;
};

export type AccessDecision =
  | { ok: true; login: string; via: "header" | "dev" }
  | {
      ok: false;
      reason: "missing_header" | "not_allowed" | "dev_login_in_production";
    };

export function parseLogins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Builds the config from raw env. `DASHBOARD_DEV_LOGIN` is only honoured outside production. */
export function accessConfigFromEnv(
  env: Record<string, string | undefined>,
): AccessConfig {
  return {
    allowedLogins: parseLogins(env.DASHBOARD_ALLOWED_LOGINS),
    devLogin: env.DASHBOARD_DEV_LOGIN?.trim() || undefined,
    production: env.NODE_ENV === "production",
  };
}

export function checkAccess(
  header: string | null | undefined,
  config: AccessConfig,
): AccessDecision {
  if (config.devLogin) {
    // Fail closed: a leftover dev flag must never open a production deployment.
    if (config.production) return { ok: false, reason: "dev_login_in_production" };
    return { ok: true, login: header?.trim() || config.devLogin, via: "dev" };
  }
  const login = header?.trim();
  if (!login) return { ok: false, reason: "missing_header" };
  if (!config.allowedLogins.includes(login.toLowerCase()))
    return { ok: false, reason: "not_allowed" };
  return { ok: true, login, via: "header" };
}
