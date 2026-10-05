import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServices } from "../../src/service/index.js";
import { createToken } from "../../src/service/tokens.js";
import { createTestApp } from "./test-app.js";

/** A running app plus MCP clients for an `agent` and a `you` token. */
export async function startMcp(env: Record<string, string> = {}) {
  const t = createTestApp(env);
  const servers: Array<{ close(): void }> = [];
  const clients: Client[] = [];
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
  const url = new URL(`http://127.0.0.1:${port}/mcp`);

  const connect = async (actor: "agent" | "you") => {
    const { token } = createToken(t.db, { name: `${actor}-token`, actor });
    const client = new Client({ name: "test", version: "0" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  };

  return {
    ...t,
    services: createServices({
      db: t.db,
      defaultIssueKey: t.config.defaultIssueKey,
      allowAgentPurge: t.config.allowAgentPurge,
    }),
    connect,
    close: async () => {
      await Promise.all(clients.map((c) => c.close()));
      for (const s of servers) s.close();
    },
  };
}

/** Calls a tool and checks text content and structuredContent agree. */
export async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const res = await client.callTool({ name, arguments: args });
  const first = (res.content as Array<{ type: string; text: string }>)[0];
  if (!res.isError && res.structuredContent) {
    if (JSON.parse(first?.text ?? "null") !== null) {
      // identical payload in both channels
      if (
        JSON.stringify(JSON.parse(first?.text ?? "")) !==
        JSON.stringify(res.structuredContent)
      ) {
        throw new Error(`structuredContent differs from text for ${name}`);
      }
    }
  }
  return {
    isError: Boolean(res.isError),
    text: first?.text ?? "",
    data: res.structuredContent as any,
  };
}
