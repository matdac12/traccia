import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { OAuthHardeningOptions } from "../src/auth/oauth-limits.js";
import { oauthClients } from "../src/db/schema.js";
import { createTestApp } from "./helpers/test-app.js";

const SECRET = "correct-horse-battery-staple";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

/** A hardened app with a fake clock the test advances instead of sleeping. */
function setup(
  hardening: OAuthHardeningOptions = {},
  env: Record<string, string> = {},
) {
  const clock = { now: 1_800_000_000_000 };
  const ctx = createTestApp({ OAUTH_ADMIN_SECRET: SECRET, ...env }, undefined, {
    now: () => clock.now,
    ...hardening,
  });
  const { app } = ctx;
  const tick = (ms: number) => {
    clock.now += ms;
  };

  const register = (
    redirectUris = [REDIRECT],
    headers: Record<string, string> = {},
  ) =>
    app.request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ redirect_uris: redirectUris }),
    });

  const challenge = () =>
    createHash("sha256")
      .update(randomBytes(32).toString("base64url"))
      .digest("base64url");

  const authorize = (
    clientId: string,
    adminSecret = SECRET,
    over: Record<string, string> = {},
    headers: Record<string, string> = {},
  ) =>
    app.request("/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge(),
        code_challenge_method: "S256",
        admin_secret: adminSecret,
        decision: "approve",
        ...over,
      }).toString(),
      redirect: "manual",
    });

  const token = (headers: Record<string, string> = {}) =>
    app.request("/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: "trc_client_nope",
        refresh_token: "x",
      }).toString(),
    });

  const newClient = async () =>
    ((await (await register()).json()) as { client_id: string }).client_id;

  return { ...ctx, tick, register, authorize, token, newClient };
}

describe("redirect URI allowlist", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
    "http://localhost:3118/callback",
    "http://127.0.0.1:54321/callback",
    "http://[::1]:8080/callback",
  ])("registers %s", async (uri) => {
    const { register } = setup();
    expect((await register([uri])).status).toBe(201);
  });

  it.each([
    "https://evil.example/cb",
    "https://claude.ai.evil.example/api/mcp/auth_callback",
    "https://claude.ai/api/mcp/other",
    "http://claude.ai/api/mcp/auth_callback",
  ])("rejects %s at /register", async (uri) => {
    const { register } = setup();
    const res = await register([uri]);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "invalid_redirect_uri",
    );
  });

  it("rejects one off-list URI among valid ones", async () => {
    const { register } = setup();
    expect((await register([REDIRECT, "https://evil.example/cb"])).status).toBe(
      400,
    );
  });

  it("accepts extras from OAUTH_EXTRA_REDIRECT_URIS", async () => {
    const { register } = setup(
      {},
      { OAUTH_EXTRA_REDIRECT_URIS: "https://extra.example/cb" },
    );
    expect((await register(["https://extra.example/cb"])).status).toBe(201);
    expect((await register(["https://extra.example/other"])).status).toBe(400);
  });

  it("rejects at /authorize a client registered with an off-list URI", async () => {
    const { authorize, db } = setup();
    // As if registered before the allowlist existed.
    db.insert(oauthClients)
      .values({
        id: "trc_client_legacy",
        name: "legacy",
        redirectUris: JSON.stringify(["https://evil.example/cb"]),
        createdAt: new Date().toISOString(),
      })
      .run();
    const res = await authorize("trc_client_legacy", SECRET, {
      redirect_uri: "https://evil.example/cb",
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("rate limits", () => {
  const tiny = (limit: number) => ({ limit, windowMs: 1000 });

  it("limits /register per IP, then recovers", async () => {
    const { register, tick } = setup({ register: tiny(2) });
    expect((await register()).status).toBe(201);
    expect((await register()).status).toBe(201);
    const res = await register();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("1");
    expect(((await res.json()) as { error: string }).error).toBe(
      "temporarily_unavailable",
    );
    tick(1000);
    expect((await register()).status).toBe(201);
  });

  it("limits /authorize POST per IP, then recovers", async () => {
    const { authorize, newClient, tick } = setup({ authorize: tiny(2) });
    const id = await newClient();
    expect((await authorize(id)).status).toBe(302);
    expect((await authorize(id)).status).toBe(302);
    const res = await authorize(id);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("1");
    tick(1000);
    expect((await authorize(id)).status).toBe(302);
  });

  it("limits /token per IP, then recovers", async () => {
    const { token, tick } = setup({ token: tiny(2) });
    expect((await token()).status).toBe(401); // unknown client: counted, not limited
    await token();
    const res = await token();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("1");
    tick(1000);
    expect((await token()).status).toBe(401);
  });

  it("keeps IPs apart when the proxy header is trusted", async () => {
    const { register } = setup({ register: tiny(1) }, { TRUST_PROXY: "true" });
    expect(
      (await register([REDIRECT], { "x-forwarded-for": "1.1.1.1" })).status,
    ).toBe(201);
    expect(
      (await register([REDIRECT], { "x-forwarded-for": "2.2.2.2" })).status,
    ).toBe(201);
    expect(
      (await register([REDIRECT], { "x-forwarded-for": "1.1.1.1" })).status,
    ).toBe(429);
  });

  it("trusts only the last X-Forwarded-For entry", async () => {
    const { register } = setup({ register: tiny(1) }, { TRUST_PROXY: "true" });
    await register([REDIRECT], { "x-forwarded-for": "9.9.9.1, 100.64.0.9" });
    const res = await register([REDIRECT], {
      "x-forwarded-for": "9.9.9.2, 100.64.0.9",
    });
    expect(res.status).toBe(429);
  });

  it("ignores a spoofed X-Forwarded-For when TRUST_PROXY is false", async () => {
    const { register } = setup({ register: tiny(1) }, { TRUST_PROXY: "false" });
    expect(
      (await register([REDIRECT], { "x-forwarded-for": "1.1.1.1" })).status,
    ).toBe(201);
    for (const spoof of ["2.2.2.2", "3.3.3.3"]) {
      const res = await register([REDIRECT], { "x-forwarded-for": spoof });
      expect(res.status).toBe(429);
    }
  });

  it("does not limit /authorize GET or /healthz", async () => {
    const { app } = setup({ authorize: tiny(1) });
    for (let i = 0; i < 3; i++) {
      expect((await app.request("/authorize?client_id=x")).status).toBe(400);
      expect((await app.request("/healthz")).status).toBe(200);
    }
  });
});

describe("admin secret lockout", () => {
  const lockout = {
    maxFailuresPerIp: 3,
    maxFailuresGlobal: 100,
    windowMs: 60_000,
    lockMs: 5 * 60_000,
  };
  const open = { authorize: { limit: 1000, windowMs: 1000 } };

  it("locks an IP after repeated bad secrets and rejects the right one", async () => {
    const { authorize, newClient } = setup({ ...open, lockout });
    const id = await newClient();
    for (let i = 0; i < 3; i++) {
      expect((await authorize(id, "wrong")).status).toBe(403);
    }
    const res = await authorize(id, SECRET);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("300");
    expect(res.headers.get("location")).toBeNull();
  });

  it("recovers once the lockout expires", async () => {
    const { authorize, newClient, tick } = setup({ ...open, lockout });
    const id = await newClient();
    for (let i = 0; i < 3; i++) await authorize(id, "wrong");
    tick(299_000);
    expect((await authorize(id, SECRET)).status).toBe(429);
    tick(1000);
    const res = await authorize(id, SECRET);
    expect(res.status).toBe(302);
    expect(
      new URL(res.headers.get("location") ?? "").searchParams.get("code"),
    ).toBeTruthy();
  });

  it("counts failures only inside the window", async () => {
    const { authorize, newClient, tick } = setup({ ...open, lockout });
    const id = await newClient();
    await authorize(id, "wrong");
    await authorize(id, "wrong");
    tick(61_000);
    await authorize(id, "wrong");
    expect((await authorize(id, SECRET)).status).toBe(302);
  });

  it("locks per IP: another IP is unaffected", async () => {
    const { authorize, newClient } = setup(
      { ...open, lockout },
      { TRUST_PROXY: "true" },
    );
    const id = await newClient();
    const from = (ip: string) => ({ "x-forwarded-for": ip });
    for (let i = 0; i < 3; i++) {
      await authorize(id, "wrong", {}, from("1.1.1.1"));
    }
    expect((await authorize(id, SECRET, {}, from("1.1.1.1"))).status).toBe(429);
    expect((await authorize(id, SECRET, {}, from("2.2.2.2"))).status).toBe(302);
  });

  it("applies a global ceiling across IPs, then recovers", async () => {
    const { authorize, newClient, tick } = setup(
      { ...open, lockout: { ...lockout, maxFailuresGlobal: 4 } },
      { TRUST_PROXY: "true" },
    );
    const id = await newClient();
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"]) {
      await authorize(id, "wrong", {}, { "x-forwarded-for": ip });
    }
    // A fresh IP with the right secret is now blocked too.
    const blocked = await authorize(
      id,
      SECRET,
      {},
      { "x-forwarded-for": "5.5.5.5" },
    );
    expect(blocked.status).toBe(429);
    tick(5 * 60_000);
    expect(
      (await authorize(id, SECRET, {}, { "x-forwarded-for": "5.5.5.5" }))
        .status,
    ).toBe(302);
  });

  it("does not let a spoofed header dodge the lockout when TRUST_PROXY is false", async () => {
    const { authorize, newClient } = setup(
      { ...open, lockout },
      { TRUST_PROXY: "false" },
    );
    const id = await newClient();
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      await authorize(id, "wrong", {}, { "x-forwarded-for": ip });
    }
    const res = await authorize(
      id,
      SECRET,
      {},
      { "x-forwarded-for": "4.4.4.4" },
    );
    expect(res.status).toBe(429);
  });

  it("a successful login clears that IP's failure count", async () => {
    const { authorize, newClient } = setup({ ...open, lockout });
    const id = await newClient();
    await authorize(id, "wrong");
    await authorize(id, "wrong");
    expect((await authorize(id, SECRET)).status).toBe(302);
    await authorize(id, "wrong");
    await authorize(id, "wrong");
    expect((await authorize(id, SECRET)).status).toBe(302);
  });
});

describe("client cap and expiry", () => {
  const roomy = { register: { limit: 1000, windowMs: 1000 } };

  it("rejects registrations beyond the cap with an OAuth error", async () => {
    const { register } = setup({
      ...roomy,
      clients: { maxClients: 2, unusedClientTtlMs: 60_000 },
    });
    expect((await register()).status).toBe(201);
    expect((await register()).status).toBe(201);
    const res = await register();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: "temporarily_unavailable",
    });
  });

  it("deletes clients that never got a code once the TTL passes", async () => {
    const { register, tick, db } = setup({
      ...roomy,
      clients: { maxClients: 2, unusedClientTtlMs: 60_000 },
    });
    await register();
    await register();
    expect((await register()).status).toBe(503);
    tick(60_001);
    expect((await register()).status).toBe(201);
    expect(db.select().from(oauthClients).all()).toHaveLength(1);
  });

  it("keeps clients inside the TTL", async () => {
    const { register, tick, db } = setup({
      ...roomy,
      clients: { maxClients: 5, unusedClientTtlMs: 60_000 },
    });
    await register();
    tick(30_000);
    await register();
    expect(db.select().from(oauthClients).all()).toHaveLength(2);
  });

  it("never deletes a client that has an authorization code", async () => {
    const { register, authorize, newClient, tick, db } = setup({
      ...roomy,
      authorize: { limit: 1000, windowMs: 1000 },
      clients: { maxClients: 10, unusedClientTtlMs: 60_000 },
    });
    const granted = await newClient();
    expect((await authorize(granted)).status).toBe(302);
    const unused = await newClient();
    tick(120_000);
    await register();
    const ids = db
      .select()
      .from(oauthClients)
      .all()
      .map((c) => c.id);
    expect(ids).toContain(granted);
    expect(ids).not.toContain(unused);
    expect(
      db.select().from(oauthClients).where(eq(oauthClients.id, granted)).get(),
    ).toBeTruthy();
  });
});
