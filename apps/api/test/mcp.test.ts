import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { mcpBodyLimit } from "../src/mcp/route.js";
import { createToken, revokeToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

const servers: Array<{ close(): void }> = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  for (const s of servers.splice(0)) s.close();
});

async function start(env: Record<string, string> = {}) {
  const t = createTestApp(env);
  const { server, port } = await new Promise<{
    server: ReturnType<typeof serve>;
    port: number;
  }>((resolve) => {
    const server = serve(
      { fetch: t.app.fetch, port: 0, hostname: "127.0.0.1" },
      (info: AddressInfo) => resolve({ server, port: info.port }),
    );
  });
  servers.push(server);
  const url = `http://127.0.0.1:${port}/mcp`;
  const agent = createToken(t.db, { name: "claude-code", actor: "agent" });
  const you = createToken(t.db, { name: "dashboard", actor: "you" });

  const connect = async (token: string) => {
    const client = new Client({ name: "test", version: "0" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  };
  const post = (body: unknown, token?: string, headers: HeadersInit = {}) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { ...t, url, agent, you, connect, post };
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "raw", version: "0" },
  },
};

describe("MCP endpoint", () => {
  it("initializes, lists tools and calls whoami with the token's actor", async () => {
    const { connect, agent, you } = await start();
    const client = await connect(agent.token);
    expect(client.getServerVersion()?.name).toBe("tracker");

    // The exact tool list is pinned in mcp-tool-list.test.ts.
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(21);

    const res = await client.callTool({ name: "whoami", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({
      actor: "agent",
      tokenName: "claude-code",
    });

    const other = await connect(you.token);
    const res2 = await other.callTool({ name: "whoami", arguments: {} });
    expect(res2.structuredContent).toEqual({
      actor: "you",
      tokenName: "dashboard",
    });
  });

  it("reports unknown tools as an error result", async () => {
    const { connect, agent } = await start();
    const client = await connect(agent.token);
    const res = await client.callTool({ name: "nope", arguments: {} });
    expect(res.isError).toBe(true);
  });

  it("serves requests with no shared session", async () => {
    const { post, agent } = await start();
    const call = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
    };
    for (const _ of [1, 2]) {
      const res = await post(call, agent.token);
      expect(res.status).toBe(200);
      expect(res.headers.get("mcp-session-id")).toBeNull();
      const body = (await res.json()) as {
        result: { structuredContent: { actor: string } };
      };
      expect(body.result.structuredContent.actor).toBe("agent");
    }
  });

  it("rejects a missing token with 401 and a Bearer challenge", async () => {
    const { post } = await start();
    const res = await post(initialize);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("rejects a revoked token", async () => {
    const { post, connect, db, agent } = await start();
    await connect(agent.token);
    revokeToken(db, agent.id);
    expect((await post(initialize, agent.token)).status).toBe(401);
    await expect(connect(agent.token)).rejects.toThrow();
  });

  it("does not leak the challenge header on success", async () => {
    const { post, agent } = await start();
    const res = await post(initialize, agent.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("rate limits per token", async () => {
    const { post, agent } = await start({ RATE_LIMIT_PER_MIN: "1" });
    expect((await post(initialize, agent.token)).status).toBe(200);
    expect((await post(initialize, agent.token)).status).toBe(429);
  });

  it.each(["GET", "DELETE"])("answers %s with 405", async (method) => {
    const { url, agent } = await start();
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${agent.token}` },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("accepts a 4 MB base64 payload", async () => {
    const { post, agent } = await start();
    const blob = "A".repeat(4 * 1024 * 1024);
    const res = await post(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "whoami", arguments: { blob } },
      },
      agent.token,
    );
    expect(res.status).toBe(200);
  });

  it("rejects an over-limit body cleanly", async () => {
    const { post, agent, config } = await start();
    const blob = "A".repeat(mcpBodyLimit(config.maxMcpUploadBytes) + 1);
    const res = await post(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "whoami", arguments: { blob } },
      },
      agent.token,
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });
});
