import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  oauthAuthCodes,
  oauthRefreshTokens,
  tokens,
} from "../src/db/schema.js";
import { listTokens, revokeToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

const SECRET = "correct-horse-battery-staple";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function setup(env: Record<string, string> = { OAUTH_ADMIN_SECRET: SECRET }) {
  const ctx = createTestApp(env);
  const { app } = ctx;

  const form = (data: Record<string, string>) => ({
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data).toString(),
  });

  async function register(redirectUris = [REDIRECT]) {
    const res = await app.request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Test <b>client</b>",
        redirect_uris: redirectUris,
      }),
    });
    return { res, body: (await res.json()) as Record<string, unknown> };
  }

  const pkce = () => {
    const verifier = randomBytes(32).toString("base64url");
    return {
      verifier,
      challenge: createHash("sha256").update(verifier).digest("base64url"),
    };
  };

  const authParams = (clientId: string, challenge: string, over = {}) => ({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st8",
    ...over,
  });

  async function authorize(
    clientId: string,
    challenge: string,
    over: Record<string, string> = {},
    admin_secret = SECRET,
  ) {
    return app.request("/authorize", {
      ...form({
        ...authParams(clientId, challenge),
        admin_secret,
        decision: "approve",
        ...over,
      }),
      redirect: "manual",
    });
  }

  const codeFrom = (res: Response) => {
    const url = new URL(res.headers.get("location") ?? "");
    return { url, code: url.searchParams.get("code") ?? "" };
  };

  const token = (data: Record<string, string>) =>
    app.request("/token", form(data));

  /** register → authorize → token. */
  async function fullGrant() {
    const { body } = await register();
    const clientId = body.client_id as string;
    const { verifier, challenge } = pkce();
    const { code } = codeFrom(await authorize(clientId, challenge));
    const res = await token({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    });
    return {
      clientId,
      verifier,
      challenge,
      code,
      res,
      tokens: (await res.json()) as Record<string, string | number>,
    };
  }

  const mcp = (accessToken: string) =>
    app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "t", version: "0" },
        },
      }),
    });

  return {
    ...ctx,
    form,
    register,
    pkce,
    authorize,
    codeFrom,
    token,
    fullGrant,
    mcp,
  };
}

describe("OAuth server", () => {
  describe("registration", () => {
    it("registers a public client", async () => {
      const { register } = setup();
      const { res, body } = await register();
      expect(res.status).toBe(201);
      expect(body).toMatchObject({
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
      });
      expect(String(body.client_id)).toMatch(/^trc_client_/);
      expect(body).not.toHaveProperty("client_secret");
    });

    it.each([
      ["http non-loopback", ["http://evil.example/cb"]],
      ["fragment", ["https://a.example/cb#x"]],
      ["not a URL", ["nope"]],
      ["javascript scheme", ["javascript:alert(1)"]],
    ])("rejects a bad redirect URI (%s)", async (_n, uris) => {
      const { register } = setup();
      const { res, body } = await register(uris);
      expect(res.status).toBe(400);
      expect(body.error).toBe("invalid_redirect_uri");
    });

    it("accepts loopback http for native clients", async () => {
      const { register } = setup();
      const { res } = await register(["http://127.0.0.1:33418/callback"]);
      expect(res.status).toBe(201);
    });

    it("rejects confidential-client metadata", async () => {
      const { app } = setup();
      const res = await app.request("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [REDIRECT],
          token_endpoint_auth_method: "client_secret_basic",
        }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_client_metadata");
    });
  });

  describe("authorize", () => {
    it("renders a consent page that escapes the client name", async () => {
      const { app, register, pkce } = setup();
      const { body } = await register();
      const q = new URLSearchParams({
        response_type: "code",
        client_id: body.client_id as string,
        redirect_uri: REDIRECT,
        code_challenge: pkce().challenge,
        code_challenge_method: "S256",
      });
      const res = await app.request(`/authorize?${q}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      const html = await res.text();
      expect(html).toContain("Test &lt;b&gt;client&lt;/b&gt;");
      expect(html).toContain('type="password"');
    });

    it("rejects an unknown client without redirecting", async () => {
      const { authorize, pkce } = setup();
      const res = await authorize("trc_client_nope", pkce().challenge);
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
    });

    it("rejects an unregistered redirect URI without redirecting", async () => {
      const { authorize, register, pkce } = setup();
      const { body } = await register();
      const res = await authorize(body.client_id as string, pkce().challenge, {
        redirect_uri: "https://evil.example/cb",
      });
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
    });

    it("rejects PKCE plain by redirecting with invalid_request", async () => {
      const { authorize, register, pkce, codeFrom } = setup();
      const { body } = await register();
      const res = await authorize(body.client_id as string, pkce().challenge, {
        code_challenge_method: "plain",
      });
      expect(res.status).toBe(302);
      const { url } = codeFrom(res);
      expect(url.searchParams.get("error")).toBe("invalid_request");
      expect(url.searchParams.get("state")).toBe("st8");
      expect(url.searchParams.has("code")).toBe(false);
    });

    it("re-renders the form on a bad admin secret and issues no code", async () => {
      const { db, authorize, register, pkce } = setup();
      const { body } = await register();
      const res = await authorize(
        body.client_id as string,
        pkce().challenge,
        {},
        "wrong-secret-entirely",
      );
      expect(res.status).toBe(403);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.text()).toContain("Wrong admin secret");
      expect(db.select().from(oauthAuthCodes).all()).toEqual([]);
    });

    it("redirects access_denied when the user denies, without the secret", async () => {
      const { authorize, register, pkce, codeFrom } = setup();
      const { body } = await register();
      const res = await authorize(
        body.client_id as string,
        pkce().challenge,
        { decision: "deny" },
        "",
      );
      const { url } = codeFrom(res);
      expect(url.searchParams.get("error")).toBe("access_denied");
    });
  });

  describe("full flow", () => {
    it("register → authorize → token → refresh, authenticating /mcp", async () => {
      const { fullGrant, token, mcp, db } = setup();
      const g = await fullGrant();
      expect(g.res.status).toBe(200);
      expect(g.res.headers.get("cache-control")).toBe("no-store");
      expect(g.tokens).toMatchObject({
        token_type: "Bearer",
        expires_in: 3600,
      });
      const access = String(g.tokens.access_token);
      expect(access).toMatch(/^trk_/);
      expect((await mcp(access)).status).toBe(200);

      // Listed as an agent token, expiring.
      const row = db
        .select()
        .from(tokens)
        .all()
        .find((t) => t.name.startsWith("oauth:"));
      expect(row).toMatchObject({ actor: "agent", revokedAt: null });
      expect(row?.expiresAt).toBeTruthy();
      expect(listTokens(db)).toHaveLength(1);

      const refreshed = await token({
        grant_type: "refresh_token",
        client_id: g.clientId,
        refresh_token: String(g.tokens.refresh_token),
      });
      expect(refreshed.status).toBe(200);
      const next = (await refreshed.json()) as Record<string, string>;
      expect(next.access_token).not.toBe(access);
      expect(next.refresh_token).not.toBe(g.tokens.refresh_token);
      expect((await mcp(next.access_token ?? "")).status).toBe(200);
      // Rotation replaces the access token in place: one list entry, old one dead.
      expect((await mcp(access)).status).toBe(401);
      expect(listTokens(db)).toHaveLength(1);
    });

    it("stops authenticating the moment the token is revoked, and blocks refresh", async () => {
      const { fullGrant, token, mcp, db } = setup();
      const g = await fullGrant();
      const access = String(g.tokens.access_token);
      expect((await mcp(access)).status).toBe(200);

      const id = listTokens(db)[0]?.id ?? "";
      revokeToken(db, id);
      expect((await mcp(access)).status).toBe(401);

      const res = await token({
        grant_type: "refresh_token",
        client_id: g.clientId,
        refresh_token: String(g.tokens.refresh_token),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_grant");
    });

    it("rejects an expired access token", async () => {
      const { fullGrant, mcp, db } = setup();
      const g = await fullGrant();
      db.update(tokens).set({ expiresAt: "2000-01-01T00:00:00.000Z" }).run();
      expect((await mcp(String(g.tokens.access_token))).status).toBe(401);
    });

    it("keeps static tokens working", async () => {
      const { app, db } = setup();
      const { createToken } = await import("../src/service/tokens.js");
      const { token } = createToken(db, { name: "static", actor: "agent" });
      const res = await app.request("/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("token endpoint failures", () => {
    const exchange = (
      g: Awaited<ReturnType<ReturnType<typeof setup>["fullGrant"]>>,
      over = {},
    ) => ({
      grant_type: "authorization_code",
      client_id: g.clientId,
      code: g.code,
      redirect_uri: REDIRECT,
      code_verifier: g.verifier,
      ...over,
    });

    async function freshCode() {
      const s = setup();
      const { body } = await s.register();
      const clientId = body.client_id as string;
      const { verifier, challenge } = s.pkce();
      const { code } = s.codeFrom(await s.authorize(clientId, challenge));
      return { ...s, clientId, verifier, code };
    }

    it("rejects a bad PKCE verifier and keeps the code usable", async () => {
      const s = await freshCode();
      const body = {
        grant_type: "authorization_code",
        client_id: s.clientId,
        code: s.code,
        redirect_uri: REDIRECT,
      };
      const bad = await s.token({
        ...body,
        code_verifier: randomBytes(32).toString("base64url"),
      });
      expect(bad.status).toBe(400);
      expect((await bad.json()).error).toBe("invalid_grant");
      const good = await s.token({ ...body, code_verifier: s.verifier });
      expect(good.status).toBe(200);
    });

    it("rejects an unknown client", async () => {
      const s = await freshCode();
      const res = await s.token({
        grant_type: "authorization_code",
        client_id: "trc_client_nope",
        code: s.code,
        redirect_uri: REDIRECT,
        code_verifier: s.verifier,
      });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("invalid_client");
    });

    it("rejects a mismatched redirect_uri", async () => {
      const s = await freshCode();
      const res = await s.token({
        grant_type: "authorization_code",
        client_id: s.clientId,
        code: s.code,
        redirect_uri: "https://claude.ai/other",
        code_verifier: s.verifier,
      });
      expect((await res.json()).error).toBe("invalid_grant");
    });

    it("rejects an expired code", async () => {
      const s = await freshCode();
      s.db
        .update(oauthAuthCodes)
        .set({ expiresAt: "2000-01-01T00:00:00.000Z" })
        .run();
      const res = await s.token({
        grant_type: "authorization_code",
        client_id: s.clientId,
        code: s.code,
        redirect_uri: REDIRECT,
        code_verifier: s.verifier,
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error_description).toContain("expired");
    });

    it("rejects a reused code and revokes what the first use issued", async () => {
      const { fullGrant, token, mcp, db } = setup();
      const g = await fullGrant();
      const replay = await token(exchange(g));
      expect(replay.status).toBe(400);
      expect((await replay.json()).error).toBe("invalid_grant");
      expect((await mcp(String(g.tokens.access_token))).status).toBe(401);
      expect(listTokens(db)[0]?.revokedAt).toBeTruthy();
    });

    it("rejects a reused refresh token and kills the grant", async () => {
      const { fullGrant, token, mcp, db } = setup();
      const g = await fullGrant();
      const refresh = (rt: string) =>
        token({
          grant_type: "refresh_token",
          client_id: g.clientId,
          refresh_token: rt,
        });
      const first = await refresh(String(g.tokens.refresh_token));
      const rotated = (await first.json()) as Record<string, string>;

      const replay = await refresh(String(g.tokens.refresh_token));
      expect(replay.status).toBe(400);
      expect((await replay.json()).error).toBe("invalid_grant");
      // The legitimate descendant is dead too.
      expect((await mcp(rotated.access_token ?? "")).status).toBe(401);
      expect((await refresh(rotated.refresh_token ?? "")).status).toBe(400);
      expect(listTokens(db)[0]?.revokedAt).toBeTruthy();
    });

    it("rejects an expired refresh token", async () => {
      const { fullGrant, token, db } = setup();
      const g = await fullGrant();
      db.update(oauthRefreshTokens)
        .set({ expiresAt: "2000-01-01T00:00:00.000Z" })
        .run();
      const res = await token({
        grant_type: "refresh_token",
        client_id: g.clientId,
        refresh_token: String(g.tokens.refresh_token),
      });
      expect(res.status).toBe(400);
    });

    it("rejects a refresh token presented by another client", async () => {
      const { fullGrant, register, token } = setup();
      const g = await fullGrant();
      const other = (await register()).body.client_id as string;
      const res = await token({
        grant_type: "refresh_token",
        client_id: other,
        refresh_token: String(g.tokens.refresh_token),
      });
      expect(res.status).toBe(400);
    });

    it("rejects unsupported grants and missing parameters", async () => {
      const { token, register } = setup();
      const clientId = (await register()).body.client_id as string;
      const a = await token({ grant_type: "password", client_id: clientId });
      expect((await a.json()).error).toBe("unsupported_grant_type");
      const b = await token({
        grant_type: "authorization_code",
        client_id: clientId,
      });
      expect((await b.json()).error).toBe("invalid_request");
    });

    it("keeps the refresh token row from outliving its use", async () => {
      const { fullGrant, token, db } = setup();
      const g = await fullGrant();
      await token({
        grant_type: "refresh_token",
        client_id: g.clientId,
        refresh_token: String(g.tokens.refresh_token),
      });
      const used = db
        .select()
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.clientId, g.clientId))
        .all()
        .filter((r) => r.usedAt);
      expect(used).toHaveLength(1);
    });
  });

  describe("when no admin secret is configured", () => {
    it("answers 503 on every OAuth endpoint", async () => {
      const { app } = setup({});
      for (const [method, path] of [
        ["POST", "/register"],
        ["GET", "/authorize"],
        ["POST", "/token"],
      ] as const) {
        const res = await app.request(path, { method });
        expect(res.status).toBe(503);
      }
    });
  });
});
