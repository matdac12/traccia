import { describe, expect, it } from "vitest";
import { createToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

const BASE = "https://traccia.example.ts.net";

describe("OAuth discovery metadata", () => {
  it("serves the protected resource document from BASE_URL, unauthenticated", async () => {
    const { app } = createTestApp({ BASE_URL: `${BASE}/` });
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({
        resource: `${BASE}/mcp`,
        authorization_servers: [BASE],
        bearer_methods_supported: ["header"],
      });
    }
  });

  it("serves the authorization server document: S256 only, code + refresh", async () => {
    const { app } = createTestApp({ BASE_URL: BASE });
    const res = await app.request("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({
      issuer: BASE,
      authorization_endpoint: `${BASE}/authorize`,
      token_endpoint: `${BASE}/token`,
      registration_endpoint: `${BASE}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("challenges an unauthenticated /mcp call with the metadata URL", async () => {
    const { app } = createTestApp({ BASE_URL: BASE });
    const res = await app.request("/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`,
    );
  });

  it("leaves static bearer tokens working on /mcp and /v1", async () => {
    const { app, db } = createTestApp({ BASE_URL: BASE });
    const { token } = createToken(db, { name: "t", actor: "agent" });
    const headers = { Authorization: `Bearer ${token}` };

    const rest = await app.request("/v1/me", { headers });
    expect(rest.status).toBe(200);

    const mcp = await app.request("/mcp", {
      method: "POST",
      headers: {
        ...headers,
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
    expect(mcp.status).toBe(200);
    expect(mcp.headers.get("www-authenticate")).toBeNull();
  });
});
