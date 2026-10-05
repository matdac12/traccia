import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

const PNG_BASE64 = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(600, 7),
]).toString("base64");

const closers: Array<{ close(): void }> = [];
const clients: Client[] = [];
let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "mcp-e2e-"));
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  for (const s of closers.splice(0)) s.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function start() {
  const t = createTestApp({ DATA_DIR: dataDir });
  const { server, port } = await new Promise<{
    server: ReturnType<typeof serve>;
    port: number;
  }>((resolve) => {
    const server = serve(
      { fetch: t.app.fetch, port: 0, hostname: "127.0.0.1" },
      (info: AddressInfo) => resolve({ server, port: info.port }),
    );
  });
  closers.push(server);
  const connect = async (actor: "agent" | "you") => {
    const { token } = createToken(t.db, { name: actor, actor });
    const client = new Client({ name: "e2e", version: "0" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
      ),
    );
    return async (name: string, args: Record<string, unknown> = {}) => {
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
      const data = res.structuredContent as any;
      return { isError: !!res.isError, text, data };
    };
  };
  return { connect };
}

/** Calls a tool and fails the test with its message if it errored. */
type Call = Awaited<ReturnType<Awaited<ReturnType<typeof start>>["connect"]>>;
async function ok(call: Call, name: string, args: Record<string, unknown>) {
  const r = await call(name, args);
  expect(r.isError, `${name}: ${r.text}`).toBe(false);
  return r.data;
}

describe("MCP end-to-end scenario", () => {
  it("walks a project from creation to restore over real HTTP", async () => {
    const { connect } = await start();
    const agent = await connect("agent");
    const you = await connect("you");

    const project = await ok(agent, "save_project", {
      name: "Pilot",
      key: "PLT",
    });
    expect(project.key).toBe("PLT");
    await ok(agent, "save_milestone", {
      project: "PLT",
      name: "M1",
      targetDate: "2026-12-31",
    });
    const label = await ok(agent, "save_issue_label", {
      name: "bug",
      project: "PLT",
    });
    expect(label.name).toBe("bug");

    const blocker = await ok(agent, "save_issue", {
      project: "PLT",
      title: "Blocker",
    });
    const parent = await ok(agent, "save_issue", {
      project: "PLT",
      title: "Parent",
    });
    const issue = await ok(agent, "save_issue", {
      project: "PLT",
      title: "Login fails on Safari",
      description: "Steps to reproduce: needle-in-description",
      labels: ["bug"],
      blockedBy: [blocker.identifier],
      parentId: parent.identifier,
      milestone: "M1",
      priority: "high",
    });
    expect(issue.labels).toEqual(["bug"]);
    expect(issue.relations.blockedBy.map((r: any) => r.identifier)).toEqual([
      blocker.identifier,
    ]);

    // Comment with a reply, then an attachment on the issue.
    const comment = await ok(agent, "save_comment", {
      issueId: issue.identifier,
      body: "Reproduced on 17.2",
    });
    const reply = await ok(you, "save_comment", {
      issueId: issue.identifier,
      parentId: comment.id,
      body: "Thanks, looking",
    });
    expect(reply.parentId).toBe(comment.id);
    const attachment = await ok(agent, "create_attachment", {
      issueId: issue.identifier,
      filename: "shot.png",
      contentBase64: PNG_BASE64,
    });
    expect(attachment.markdown).toContain("shot.png");

    const full = await ok(agent, "get_issue", { id: issue.identifier });
    expect(full.comments).toHaveLength(2);
    expect(full.attachments).toHaveLength(1);
    expect(full.parent).toBeDefined();

    // Filters and full-text search.
    const ids = async (args: Record<string, unknown>) =>
      (await ok(agent, "list_issues", args)).items.map(
        (i: any) => i.identifier,
      );
    expect(await ids({ label: "bug" })).toEqual([issue.identifier]);
    expect(await ids({ parentId: parent.identifier })).toEqual([
      issue.identifier,
    ]);
    expect(await ids({ milestone: "M1" })).toEqual([issue.identifier]);
    expect(await ids({ priority: "high" })).toEqual([issue.identifier]);
    expect(await ids({ createdBy: "agent", project: "PLT" })).toHaveLength(3);
    expect(await ids({ createdBy: "you" })).toEqual([]);
    expect(await ids({ assignee: "none", project: "PLT" })).toHaveLength(3);
    expect(await ids({ query: "needle-in-description" })).toEqual([
      issue.identifier,
    ]);
    expect(await ids({ query: "Reproduced" })).toEqual([issue.identifier]);
    expect(await ids({ query: "nonexistentterm" })).toEqual([]);

    // Status transitions.
    for (const status of ["in_progress", "in_review", "done"]) {
      const updated = await ok(agent, "save_issue", {
        id: issue.identifier,
        status,
      });
      expect(updated.status).toBe(status);
    }
    expect(await ids({ status: ["Done"], project: "PLT" })).toEqual([
      issue.identifier,
    ]);

    // Delete, list with includeDeleted, restore.
    await ok(agent, "delete_issue", { id: issue.identifier });
    expect(await ids({ query: "needle-in-description" })).toEqual([]);
    const withDeleted = await ids({ includeDeleted: true, project: "PLT" });
    expect(withDeleted).toContain(issue.identifier);
    await ok(agent, "restore", { type: "issue", id: issue.identifier });
    expect(await ids({ label: "bug" })).toEqual([issue.identifier]);
    const restored = await ok(agent, "get_issue", { id: issue.identifier });
    expect(restored.comments).toHaveLength(2);
    expect(restored.attachments).toHaveLength(1);

    // Agents cannot purge by default; `you` can, once soft-deleted.
    await ok(agent, "delete_issue", { id: issue.identifier });
    const denied = await agent("delete_issue", {
      id: issue.identifier,
      purge: true,
    });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/Agents cannot purge by default/);
    await ok(you, "delete_issue", { id: issue.identifier, purge: true });
    expect((await agent("get_issue", { id: issue.identifier })).isError).toBe(
      true,
    );
  });

  it("stamps writes with the token's actor", async () => {
    const { connect } = await start();
    const agent = await connect("agent");
    const you = await connect("you");
    await ok(agent, "save_project", { name: "P", key: "ACT" });

    const byAgent = await ok(agent, "save_issue", {
      project: "ACT",
      title: "From agent",
    });
    const byYou = await ok(you, "save_issue", {
      project: "ACT",
      title: "From you",
    });
    await ok(agent, "save_comment", { issueId: byYou.identifier, body: "a" });
    await ok(you, "save_comment", { issueId: byAgent.identifier, body: "y" });
    await ok(agent, "save_issue", { id: byYou.identifier, status: "Todo" });

    const a = await ok(agent, "get_issue", {
      id: byAgent.identifier,
      include: ["comments", "activity"],
    });
    const y = await ok(agent, "get_issue", {
      id: byYou.identifier,
      include: ["comments", "activity"],
    });
    expect(a.createdBy).toBe("agent");
    expect(y.createdBy).toBe("you");
    expect(a.comments.map((c: any) => c.actor)).toEqual(["you"]);
    expect(y.comments.map((c: any) => c.actor)).toEqual(["agent"]);
    const trail = (x: any) => x.activity.map((e: any) => [e.type, e.actor]);
    expect(trail(a)).toEqual([
      ["issue_created", "agent"],
      ["comment_added", "you"],
    ]);
    expect(trail(y)).toEqual([
      ["issue_created", "you"],
      ["comment_added", "agent"],
      ["status_changed", "agent"],
    ]);
  });
});
