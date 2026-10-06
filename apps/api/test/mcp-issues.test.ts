import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServices } from "../src/service/index.js";
import { createToken } from "../src/service/tokens.js";
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
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  const connect = async (actor: "agent" | "you") => {
    const { token } = createToken(t.db, { name: `t-${actor}`, actor });
    const client = new Client({ name: "test", version: "0" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
      return {
        isError: !!res.isError,
        text,
        data: res.structuredContent as any,
        res,
      };
    };
    return call;
  };
  const services = createServices({
    db: t.db,
    defaultIssueKey: t.config.defaultIssueKey,
    allowAgentPurge: t.config.allowAgentPurge,
  });
  services.projects.create("you", { name: "Alpha", key: "ALP" });
  services.projects.create("you", { name: "Beta", key: "BET" });
  services.labels.create({ name: "bug" });
  services.labels.create({ name: "feature" });
  return { ...t, connect, services };
}

describe("MCP issue tools", () => {
  it("lists the issue and comment tools", async () => {
    const { connect } = await start();
    const call = await connect("agent");
    expect(call).toBeTypeOf("function");
  });

  it("save_issue update is atomic: a blocker cycle leaves fields unchanged", async () => {
    const { connect, services } = await start();
    const call = await connect("agent");
    await call("save_issue", { title: "A", project: "Alpha" });
    await call("save_issue", { title: "B", project: "Alpha" });
    await call("save_issue", { title: "C", project: "Alpha" });
    await call("save_issue", { id: "ALP-2", blockedBy: ["ALP-1"] });
    await call("save_issue", { id: "ALP-3", blockedBy: ["ALP-2"] });
    const before = services.issues.get("ALP-1", ["relations"]);

    const res = await call("save_issue", {
      id: "ALP-1",
      title: "Renamed",
      status: "Done",
      labels: ["Bug"],
      blockedBy: ["ALP-3"],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("ALP-3 -> ALP-1 -> ALP-2 -> ALP-3");
    const after = services.issues.get("ALP-1", ["relations"]);
    expect(after).toEqual(before);
    expect(after.title).toBe("A");
  });

  it("creates, gets and updates an issue with human-friendly refs", async () => {
    const { connect, services } = await start();
    const call = await connect("agent");
    services.milestones.create("you", "ALP", { name: "M1" });

    const created = await call("save_issue", {
      title: "First",
      project: "Alpha",
      description: "Body **md**",
      status: "In Progress",
      priority: "high",
      labels: ["Bug"],
      milestone: "M1",
      estimate: 3,
      assignee: "you",
    });
    expect(created.isError).toBe(false);
    expect(created.data).toMatchObject({
      identifier: "ALP-1",
      status: "in_progress",
      priority: 2,
      labels: ["bug"],
      project: "ALP",
      milestone: "M1",
      estimate: 3,
      assignee: "you",
    });
    expect(JSON.parse(created.text)).toEqual(created.data);

    const got = await call("get_issue", { id: "ALP-1" });
    expect(got.data).toMatchObject({
      identifier: "ALP-1",
      description: "Body **md**",
      createdBy: "agent",
    });
    expect(got.data.descriptionSnippet).toBeUndefined();

    const updated = await call("save_issue", {
      id: "ALP-1",
      status: "Done",
      assignee: null,
      milestone: null,
    });
    expect(updated.data).toMatchObject({ status: "done", labels: ["bug"] });
    expect(updated.data.assignee).toBeUndefined();
    expect(updated.data.milestone).toBeUndefined();
    // Untouched fields survive a partial update.
    expect(updated.data.title).toBe("First");
  });

  it("replaces label sets and blocker sets wholesale", async () => {
    const { connect } = await start();
    const call = await connect("agent");
    for (const t of ["a", "b", "c", "d"]) {
      await call("save_issue", { title: t, project: "ALP" });
    }
    await call("save_issue", { id: "ALP-1", labels: ["bug", "feature"] });
    const l = await call("save_issue", { id: "ALP-1", labels: ["feature"] });
    expect(l.data.labels).toEqual(["feature"]);
    const cleared = await call("save_issue", { id: "ALP-1", labels: [] });
    expect(cleared.data.labels).toBeUndefined();

    const r1 = await call("save_issue", {
      id: "ALP-1",
      blockedBy: ["ALP-2", "ALP-3"],
      blocks: ["ALP-4"],
    });
    expect(
      r1.data.relations.blockedBy.map(
        (r: { identifier: string }) => r.identifier,
      ),
    ).toEqual(["ALP-2", "ALP-3"]);
    expect(r1.data.relations.blocks).toHaveLength(1);

    const r2 = await call("save_issue", { id: "ALP-1", blockedBy: ["ALP-3"] });
    expect(
      r2.data.relations.blockedBy.map(
        (r: { identifier: string }) => r.identifier,
      ),
    ).toEqual(["ALP-3"]);
    // `blocks` was not provided, so it is untouched.
    expect(r2.data.relations.blocks).toHaveLength(1);

    const got = await call("get_issue", { id: "ALP-1" });
    expect(got.data.relations.blockedBy).toHaveLength(1);
    expect(got.data.relations.blocks[0].identifier).toBe("ALP-4");

    const r3 = await call("save_issue", {
      id: "ALP-1",
      blockedBy: [],
      blocks: [],
    });
    expect(r3.data.relations).toEqual({ blockedBy: [], blocks: [], related: [] });
  });

  it("sets symmetric related links, reads them on both issues and rejects a self-link", async () => {
    const { connect } = await start();
    const call = await connect("agent");
    for (const t of ["a", "b", "c"]) {
      await call("save_issue", { title: t, project: "ALP" });
    }
    const r = await call("save_issue", {
      id: "ALP-1",
      related: ["ALP-2", "ALP-3"],
    });
    expect(r.isError).toBe(false);
    expect(
      r.data.relations.related.map((x: { identifier: string }) => x.identifier),
    ).toEqual(["ALP-2", "ALP-3"]);

    const got = await call("get_issue", { id: "ALP-2" });
    expect(got.data.relations.related[0].identifier).toBe("ALP-1");

    // The same link given the other way round is a no-op.
    const again = await call("save_issue", { id: "ALP-2", related: ["ALP-1"] });
    expect(
      again.data.relations.related.map(
        (x: { identifier: string }) => x.identifier,
      ),
    ).toEqual(["ALP-1"]);

    const cleared = await call("save_issue", { id: "ALP-1", related: [] });
    expect(cleared.data.relations.related).toEqual([]);

    const self = await call("save_issue", { id: "ALP-1", related: ["ALP-1"] });
    expect(self.isError).toBe(true);
    expect(self.text).toContain("related to itself");
  });

  it("rejects a stale expectedUpdatedAt and accepts the current one", async () => {
    const { connect } = await start();
    const call = await connect("agent");
    const created = await call("save_issue", { title: "t", project: "ALP" });
    await new Promise((r) => setTimeout(r, 5));
    await call("save_issue", { id: "ALP-1", title: "changed" });
    const stale = await call("save_issue", {
      id: "ALP-1",
      title: "mine",
      expectedUpdatedAt: created.data.updatedAt,
    });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("modified since");
    expect(stale.text).toContain("get_issue");
    const current = (await call("get_issue", { id: "ALP-1" })).data.updatedAt;
    const ok = await call("save_issue", {
      id: "ALP-1",
      title: "mine",
      expectedUpdatedAt: current,
    });
    expect(ok.isError).toBe(false);
    expect(ok.data.title).toBe("mine");
  });

  it("gives actionable errors", async () => {
    const { connect } = await start();
    const call = await connect("agent");
    await call("save_issue", { title: "t", project: "ALP" });

    const label = await call("save_issue", {
      title: "x",
      project: "ALP",
      labels: ["bugg"],
    });
    expect(label.isError).toBe(true);
    expect(label.text).toContain("Unknown label 'bugg'");
    expect(label.text).toContain("Existing labels: bug, feature");
    expect(label.text).toContain("save_issue_label");
    // Nothing half-created.
    expect((await call("list_issues")).data.items).toHaveLength(1);
    const labelUpdate = await call("save_issue", {
      id: "ALP-1",
      labels: ["bugg"],
    });
    expect(labelUpdate.text).toContain("Unknown label 'bugg'");

    const project = await call("save_issue", { title: "x", project: "Nope" });
    expect(project.isError).toBe(true);
    expect(project.text).toContain('Project "Nope" not found');

    const bad = await call("save_issue", { id: "ALP-1", status: "Doing" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("must be one of: backlog, todo, in_progress");
    expect(bad.text).toContain('display names like "In Progress"');

    expect((await call("save_issue", { title: "x" })).text).toContain(
      "requires 'title' and 'project'",
    );
    expect((await call("get_issue", { id: "ALP-99" })).text).toContain(
      "not found",
    );
    const ms = await call("save_issue", { id: "ALP-1", milestone: "Zed" });
    expect(ms.text).toContain("Unknown milestone 'Zed'");
  });

  it("filters list_issues, including updatedAfter durations and ALL-labels", async () => {
    const { connect } = await start();
    const call = await connect("agent");
    await call("save_issue", {
      title: "one",
      project: "ALP",
      labels: ["bug", "feature"],
      status: "todo",
    });
    await call("save_issue", { title: "two", project: "ALP", labels: ["bug"] });
    await call("save_issue", { title: "three", project: "BET", priority: 1 });

    const ids = (r: { data: { items: Array<{ identifier: string }> } }) =>
      r.data.items.map((i) => i.identifier).sort();
    expect(
      ids(await call("list_issues", { label: ["bug", "feature"] })),
    ).toEqual(["ALP-1"]);
    expect(ids(await call("list_issues", { label: "bug" }))).toEqual([
      "ALP-1",
      "ALP-2",
    ]);
    expect(ids(await call("list_issues", { project: "BET" }))).toEqual([
      "BET-1",
    ]);
    expect(
      ids(
        await call("list_issues", {
          status: ["Todo", "Backlog"],
          project: "ALP",
        }),
      ),
    ).toEqual(["ALP-1", "ALP-2"]);
    expect(ids(await call("list_issues", { priority: "urgent" }))).toEqual([
      "BET-1",
    ]);
    expect(ids(await call("list_issues", { query: "two" }))).toEqual(["ALP-2"]);
    expect(
      ids(await call("list_issues", { updatedAfter: "-P1D" })),
    ).toHaveLength(3);
    expect(
      ids(await call("list_issues", { updatedAfter: "2999-01-01T00:00:00Z" })),
    ).toEqual([]);
    const bad = await call("list_issues", { updatedAfter: "yesterday" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("-P1D");

    const page = await call("list_issues", { limit: 2, orderBy: "createdAt" });
    expect(page.data.items).toHaveLength(2);
    const next = await call("list_issues", {
      limit: 2,
      orderBy: "createdAt",
      cursor: page.data.nextCursor,
    });
    expect(next.data.items).toHaveLength(1);
  });

  it("treats a hostile query string as plain text", async () => {
    const { connect } = await start();
    const call = await connect("agent");
    await call("save_issue", { title: "login bug", project: "ALP" });
    for (const q of [
      '"',
      '" OR 1=1 --',
      "login AND (",
      "*",
      "NEAR(",
      "'; DROP TABLE issues; --",
      "title:login",
      "-",
    ]) {
      const r = await call("list_issues", { query: q });
      expect(r.isError, q).toBe(false);
    }
    const hit = await call("list_issues", { query: 'login" OR "zzz' });
    expect(hit.isError).toBe(false);
    expect((await call("list_issues")).data.items).toHaveLength(1);
  });

  it("keeps 50 long-description issues compact", async () => {
    const { connect } = await start();
    const call = await connect("agent");
    const long = "lorem ipsum ".repeat(1000);
    for (let i = 0; i < 50; i++) {
      await call("save_issue", {
        title: `Issue ${i}`,
        project: "ALP",
        description: long,
        labels: ["bug"],
      });
    }
    const list = await call("list_issues");
    expect(list.data.items).toHaveLength(50);
    for (const item of list.data.items) {
      expect(JSON.stringify(item).length).toBeLessThan(500);
      expect(item.description).toBeUndefined();
      expect(item.descriptionSnippet.length).toBeLessThanOrEqual(161);
    }
    expect(list.text.length).toBeLessThan(50 * 500);
  });

  it("returns children, activity and trims includes in get_issue", async () => {
    const { connect } = await start();
    const call = await connect("agent");
    await call("save_issue", { title: "parent", project: "ALP" });
    await call("save_issue", {
      title: "kid",
      project: "ALP",
      parentId: "ALP-1",
    });
    await call("save_comment", { issueId: "ALP-1", body: "hi" });

    const full = await call("get_issue", { id: "ALP-1" });
    expect(
      full.data.children.map((c: { identifier: string }) => c.identifier),
    ).toEqual(["ALP-2"]);
    expect(full.data.comments).toHaveLength(1);
    expect(full.data.activity).toBeUndefined();
    const kid = await call("get_issue", { id: "ALP-2", include: ["activity"] });
    expect(kid.data.parent).toBe("ALP-1");
    expect(kid.data.activity[0].type).toBe("issue_created");
    expect(kid.data.comments).toBeUndefined();
    const subs = await call("list_issues", { parentId: "ALP-1" });
    expect(subs.data.items).toHaveLength(1);
  });

  it("moves an issue between projects keeping its identifier", async () => {
    const { connect } = await start();
    const call = await connect("agent");
    await call("save_issue", { title: "mover", project: "ALP" });
    const moved = await call("save_issue", { id: "ALP-1", project: "Beta" });
    expect(moved.data).toMatchObject({ identifier: "ALP-1", project: "BET" });
  });

  it("deletes softly, hides, and restricts purge", async () => {
    const { connect } = await start();
    const agent = await connect("agent");
    const you = await connect("you");
    await agent("save_issue", { title: "doomed", project: "ALP" });

    const early = await you("delete_issue", { id: "ALP-1", purge: true });
    expect(early.isError).toBe(true);
    expect(early.text).toContain("must be deleted before");

    const del = await agent("delete_issue", { id: "ALP-1" });
    expect(del.isError).toBe(false);
    expect(del.data).toMatchObject({
      type: "issue",
      identifier: "ALP-1",
      title: expect.not.stringMatching(/^$/),
    });
    expect((await agent("list_issues")).data.items).toHaveLength(0);
    const withDeleted = await agent("list_issues", { includeDeleted: true });
    expect(withDeleted.data.items[0].deleted).toBe(true);

    const denied = await agent("delete_issue", { id: "ALP-1", purge: true });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain("Agents cannot purge by default");

    const restored = await agent("restore", { type: "issue", id: "ALP-1" });
    expect(restored.data).toMatchObject({ identifier: "ALP-1" });
    await agent("delete_issue", { id: "ALP-1" });

    const purged = await you("delete_issue", { id: "ALP-1", purge: true });
    expect(purged.isError).toBe(false);
    expect(
      (await you("list_issues", { includeDeleted: true })).data.items,
    ).toHaveLength(0);
  });
});

describe("MCP comment tools", () => {
  it("creates, threads, lists, edits and deletes comments", async () => {
    const { connect } = await start();
    const agent = await connect("agent");
    const you = await connect("you");
    await agent("save_issue", { title: "t", project: "ALP" });

    const top = await agent("save_comment", { issueId: "ALP-1", body: "top" });
    expect(top.data).toMatchObject({ body: "top", actor: "agent" });
    const reply = await you("save_comment", {
      issueId: "ALP-1",
      body: "re",
      parentId: top.data.id,
    });
    expect(reply.data.parentId).toBe(top.data.id);
    await agent("save_comment", { issueId: "ALP-1", body: "second" });

    const list = await agent("list_comments", { issueId: "ALP-1" });
    expect(list.data.items.map((c: { body: string }) => c.body)).toEqual([
      "top",
      "re",
      "second",
    ]);
    expect(list.data.nextCursor).toBeNull();
    const p1 = await agent("list_comments", { issueId: "ALP-1", limit: 2 });
    expect(p1.data.items).toHaveLength(2);
    const p2 = await agent("list_comments", {
      issueId: "ALP-1",
      limit: 2,
      cursor: p1.data.nextCursor,
    });
    expect(p2.data.items.map((c: { body: string }) => c.body)).toEqual([
      "second",
    ]);

    const nested = await agent("save_comment", {
      issueId: "ALP-1",
      body: "x",
      parentId: reply.data.id,
    });
    expect(nested.isError).toBe(true);
    expect(nested.text).toContain("Cannot reply to a reply");

    const edit = await agent("save_comment", {
      id: top.data.id,
      body: "edited",
    });
    expect(edit.data.body).toBe("edited");
    const foreign = await you("save_comment", {
      id: top.data.id,
      body: "hijack",
    });
    expect(foreign.isError).toBe(true);
    expect(foreign.text).toContain(
      "Only the actor who wrote a comment may edit it",
    );

    expect((await agent("save_comment", { body: "x" })).text).toContain(
      "requires 'issueId'",
    );

    const del = await agent("delete_comment", { id: top.data.id });
    expect(del.isError).toBe(false);
    const after = await agent("list_comments", { issueId: "ALP-1" });
    expect(after.data.items.map((c: { body: string }) => c.body)).toEqual([
      "second",
    ]);
    const all = await agent("list_comments", {
      issueId: "ALP-1",
      includeDeleted: true,
    });
    expect(
      all.data.items.find((c: { id: string }) => c.id === top.data.id).deleted,
    ).toBe(true);

    const denied = await agent("delete_comment", {
      id: top.data.id,
      purge: true,
    });
    expect(denied.text).toContain("Agents cannot purge by default");
    const purged = await you("delete_comment", {
      id: top.data.id,
      purge: true,
    });
    expect(purged.isError).toBe(false);
  });

  it("errors on an unknown issue", async () => {
    const { connect } = await start();
    const call = await connect("agent");
    expect((await call("list_comments", { issueId: "ALP-9" })).text).toContain(
      "not found",
    );
  });
});
