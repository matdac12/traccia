import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { createToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

/** Spec Appendix A.8: the 20 tools. */
const SPEC_TOOLS = [
  "list_projects",
  "get_project",
  "save_project",
  "delete_project",
  "list_milestones",
  "save_milestone",
  "delete_milestone",
  "list_issues",
  "get_issue",
  "save_issue",
  "delete_issue",
  "list_comments",
  "save_comment",
  "delete_comment",
  "list_issue_labels",
  "save_issue_label",
  "create_attachment",
  "get_attachment",
  "delete_attachment",
  "restore",
];

/**
 * Plumbing tool kept on purpose, outside the A.8 count (TRC-23): the
 * cheapest way to confirm a token works and which actor it writes as.
 */
const WHOAMI = "whoami";

/**
 * Size of the `tools/list` HTTP response in bytes, paid in every agent's
 * context. Measured by POSTing initialize then tools/list to /mcp. The
 * budget is the measured size plus ~3% margin; raise it deliberately in the
 * PR that adds tools or text (TRC-123 cut it from 15454).
 */
const SIZE_BASELINE_BYTES = 11964;
const MAX_TOOLS_LIST_BYTES = Math.ceil(SIZE_BASELINE_BYTES * 1.03);

let server: ReturnType<typeof serve> | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  server?.close();
});

async function listTools() {
  const t = createTestApp();
  const port = await new Promise<number>((resolve) => {
    server = serve(
      { fetch: t.app.fetch, port: 0, hostname: "127.0.0.1" },
      (info: AddressInfo) => resolve(info.port),
    );
  });
  const { token } = createToken(t.db, { name: "agent", actor: "agent" });
  client = new Client({ name: "snapshot", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const { tools } = await client.listTools();
  return [...tools].sort((a, b) => a.name.localeCompare(b.name));
}

describe("MCP tool list", () => {
  it("registers exactly the A.8 tools plus whoami", async () => {
    const names = (await listTools()).map((t) => t.name);
    expect(names).toEqual([...SPEC_TOOLS, WHOAMI].sort());
    // Deliberately absent: Linear's teams/users/cycles/documents tools and
    // any label delete.
    expect(names.filter((n) => /team|user|cycle|document/.test(n))).toEqual([]);
    expect(names).not.toContain("delete_issue_label");
  });

  it("matches the checked-in snapshot of names, descriptions and schemas", async () => {
    const tools = await listTools();
    await expect(JSON.stringify(tools, null, 2) + "\n").toMatchFileSnapshot(
      "./__snapshots__/mcp-tools.json",
    );
  });

  it("stays within the context size budget", async () => {
    const t = createTestApp();
    const { token } = createToken(t.db, { name: "agent", actor: "agent" });
    const post = (body: unknown) =>
      t.app.request("/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "size", version: "0" },
      },
    });
    const text = await (
      await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    ).text();
    const size = Buffer.byteLength(text);
    expect(
      size,
      `tools/list is ${size} bytes; baseline ${SIZE_BASELINE_BYTES}. Trim descriptions or bump SIZE_BASELINE_BYTES deliberately.`,
    ).toBeLessThanOrEqual(MAX_TOOLS_LIST_BYTES);
  });
});
