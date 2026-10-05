import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "../lib/env";

const base = {
  TRACKER_API_URL: "http://api:8787/",
  TRACKER_API_TOKEN: "tok_abc",
  DASHBOARD_ALLOWED_LOGINS: "me@example.com",
  NODE_ENV: "production",
};

describe("parseEnv", () => {
  it("accepts a valid env and trims the API url", () => {
    const env = parseEnv(base);
    expect(env.apiUrl).toBe("http://api:8787");
    expect(env.apiToken).toBe("tok_abc");
    expect(env.access).toMatchObject({ allowedLogins: ["me@example.com"], production: true });
  });
  it("names every missing variable", () => {
    const err = (() => {
      try {
        parseEnv({ NODE_ENV: "production" });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err).toBeInstanceOf(EnvError);
    for (const name of ["TRACKER_API_URL", "TRACKER_API_TOKEN", "DASHBOARD_ALLOWED_LOGINS"])
      expect(err?.message).toContain(name);
  });
  it("treats empty strings as unset (compose passes empty defaults)", () => {
    expect(() => parseEnv({ ...base, TRACKER_API_TOKEN: "" })).toThrow(/TRACKER_API_TOKEN/);
  });
  it("refuses DASHBOARD_DEV_LOGIN in production", () => {
    expect(() => parseEnv({ ...base, DASHBOARD_DEV_LOGIN: "dev@local" })).toThrow(/DASHBOARD_DEV_LOGIN.*production/);
  });
  it("allows the dev login without an allowlist in development", () => {
    const env = parseEnv({ ...base, NODE_ENV: "development", DASHBOARD_ALLOWED_LOGINS: "", DASHBOARD_DEV_LOGIN: "dev@local" });
    expect(env.access.devLogin).toBe("dev@local");
  });
});
