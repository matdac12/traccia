import { describe, expect, it } from "vitest";
import { accessConfigFromEnv, checkAccess, LOGIN_HEADER } from "../lib/access";
import { proxy } from "../proxy";
import { NextRequest } from "next/server";

const cfg = (env: Record<string, string>) => accessConfigFromEnv(env);

describe("checkAccess", () => {
  const config = cfg({ DASHBOARD_ALLOWED_LOGINS: "Mattia@Example.com, other@example.com" });

  it("passes an allowed login, ignoring case and list whitespace", () => {
    expect(checkAccess("mattia@example.com", config)).toEqual({ ok: true, login: "mattia@example.com", via: "header" });
    expect(checkAccess("OTHER@example.com", config).ok).toBe(true);
  });
  it("rejects a missing or blank header", () => {
    expect(checkAccess(null, config)).toEqual({ ok: false, reason: "missing_header" });
    expect(checkAccess("  ", config)).toEqual({ ok: false, reason: "missing_header" });
  });
  it("rejects a login that is not on the list", () => {
    expect(checkAccess("eve@example.com", config)).toEqual({ ok: false, reason: "not_allowed" });
  });
  it("rejects everyone when the allowlist is empty", () => {
    expect(checkAccess("mattia@example.com", cfg({})).ok).toBe(false);
  });
  it("accepts the dev login outside production, with or without a header", () => {
    const dev = cfg({ DASHBOARD_DEV_LOGIN: "dev@local", NODE_ENV: "development" });
    expect(checkAccess(null, dev)).toEqual({ ok: true, login: "dev@local", via: "dev" });
    expect(checkAccess("x@y.z", dev)).toMatchObject({ ok: true, via: "dev" });
  });
  it("refuses the dev login in production, even for an allowed header", () => {
    const prod = cfg({ DASHBOARD_DEV_LOGIN: "dev@local", NODE_ENV: "production", DASHBOARD_ALLOWED_LOGINS: "a@b.c" });
    expect(checkAccess(null, prod)).toEqual({ ok: false, reason: "dev_login_in_production" });
    expect(checkAccess("a@b.c", prod)).toEqual({ ok: false, reason: "dev_login_in_production" });
  });
});

describe("proxy (runs on every route)", () => {
  const withEnv = async (env: Record<string, string>, fn: () => Promise<void> | void) => {
    const saved = { ...process.env };
    for (const k of ["DASHBOARD_ALLOWED_LOGINS", "DASHBOARD_DEV_LOGIN"]) delete process.env[k];
    Object.assign(process.env, env);
    try {
      await fn();
    } finally {
      process.env = saved;
    }
  };
  const req = (path: string, login?: string) =>
    new NextRequest(`http://localhost:3000${path}`, { headers: login ? { [LOGIN_HEADER]: login } : {} });
  const allowed = { DASHBOARD_ALLOWED_LOGINS: "me@example.com", NODE_ENV: "production" };

  it("lets an allowed login through on pages and /api paths", () =>
    withEnv(allowed, () => {
      for (const path of ["/", "/issues", "/api/anything", "/healthz"]) {
        const res = proxy(req(path, "me@example.com"));
        expect(res.status, path).toBe(200);
        expect(res.headers.get("x-middleware-next")).toBe("1");
      }
    }));
  it("answers 403 HTML for a page without the header or with another login", () =>
    withEnv(allowed, async () => {
      for (const r of [req("/issues"), req("/issues", "eve@example.com")]) {
        const res = proxy(r);
        expect(res.status).toBe(403);
        expect(res.headers.get("content-type")).toContain("text/html");
        expect(await res.text()).toContain("Access denied");
      }
    }));
  it("answers 403 JSON under /api", () =>
    withEnv(allowed, async () => {
      for (const r of [req("/api/x"), req("/api/x/y", "eve@example.com"), req("/api")]) {
        const res = proxy(r);
        expect(res.status).toBe(403);
        expect(res.headers.get("content-type")).toContain("application/json");
        expect((await res.json()).error.code).toBe("forbidden");
      }
    }));
  it("refuses the dev bypass when NODE_ENV=production", () =>
    withEnv({ ...allowed, DASHBOARD_DEV_LOGIN: "dev@local" }, () => {
      expect(proxy(req("/issues")).status).toBe(403);
      expect(proxy(req("/issues", "me@example.com")).status).toBe(403);
    }));
  it("honours the dev bypass in development", () =>
    withEnv({ DASHBOARD_DEV_LOGIN: "dev@local", NODE_ENV: "development" }, () => {
      expect(proxy(req("/issues")).status).toBe(200);
    }));
  it("matches every path", async () => {
    const { config } = await import("../proxy");
    expect(config.matcher).toBe("/:path*");
  });
});
