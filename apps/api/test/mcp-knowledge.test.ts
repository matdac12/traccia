import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { call, startMcp } from "./helpers/mcp-client.js";

let app: Awaited<ReturnType<typeof startMcp>>;
let dataDir: string | undefined;
afterEach(async () => {
  await app.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

async function setup(env: Record<string, string> = {}) {
  dataDir = await mkdtemp(path.join(tmpdir(), "mcp-knowledge-"));
  app = await startMcp({ DATA_DIR: dataDir, ...env });
  app.services.projects.create("you", { name: "Alpha" });
  app.services.projects.create("you", { name: "Beta", key: "BET" });
  return { agent: await app.connect("agent"), you: await app.connect("you") };
}

describe("memory tools", () => {
  it("saves, lists with snippets and filters, gets and updates", async () => {
    const { agent } = await setup();
    const created = await call(agent, "save_memory", {
      project: "Alpha",
      title: "Deploy",
      body: "Run `make ship` " + "x".repeat(400),
      tags: ["ops", "ops", "ci"],
    });
    expect(created.data).toMatchObject({
      title: "Deploy",
      tags: ["ops", "ci"],
      createdBy: "agent",
    });
    await call(agent, "save_memory", {
      project: "Alpha",
      title: "Other",
      tags: ["misc"],
    });
    await call(agent, "save_memory", { project: "Beta", title: "Deploy B" });

    const list = await call(agent, "list_memories", {
      project: "Alpha",
      query: "make ship",
      tags: ["ci"],
    });
    expect(list.data.items).toHaveLength(1);
    expect(list.data.items[0].body).toBeUndefined();
    expect(list.data.items[0].bodySnippet.length).toBeLessThan(200);

    const all = await call(agent, "list_memories", { project: "Alpha" });
    expect(all.data.items.map((m: any) => m.title)).toEqual([
      "Other",
      "Deploy",
    ]);

    const got = await call(agent, "get_memory", { id: created.data.id });
    expect(got.data.body).toContain("x".repeat(400));

    const upd = await call(agent, "save_memory", {
      id: created.data.id,
      title: "Deploy v2",
      expectedUpdatedAt: created.data.updatedAt,
    });
    expect(upd.data.title).toBe("Deploy v2");
    expect(upd.data.tags).toEqual(["ops", "ci"]);
  });

  it("reports validation, conflict and unknown project as actionable errors", async () => {
    const { agent } = await setup();
    const noTitle = await call(agent, "save_memory", { project: "Alpha" });
    expect(noTitle.isError).toBe(true);
    expect(noTitle.text).toMatch(/project and title/);

    const m = await call(agent, "save_memory", {
      project: "Alpha",
      title: "T",
    });
    const stale = await call(agent, "save_memory", {
      id: m.data.id,
      title: "U",
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    expect(stale.isError).toBe(true);
    expect(stale.text).toMatch(/modified/);

    const bad = await call(agent, "list_memories", { project: "Nope" });
    expect(bad.isError).toBe(true);
  });

  it("soft-deletes, restores via restore, and lets an agent purge", async () => {
    const { agent } = await setup();
    const m = await call(agent, "save_memory", {
      project: "Alpha",
      title: "T",
    });
    const del = await call(agent, "delete_memory", { id: m.data.id });
    expect(del.isError).toBe(false);
    expect((await call(agent, "get_memory", { id: m.data.id })).isError).toBe(
      true,
    );
    expect(
      (await call(agent, "list_memories", { project: "Alpha" })).data.items,
    ).toEqual([]);
    expect(
      (
        await call(agent, "list_memories", {
          project: "Alpha",
          includeDeleted: true,
        })
      ).data.items[0].deleted,
    ).toBe(true);

    const restored = await call(agent, "restore", {
      type: "memory",
      id: m.data.id,
    });
    expect(restored.isError).toBe(false);
    expect((await call(agent, "get_memory", { id: m.data.id })).isError).toBe(
      false,
    );

    await call(agent, "delete_memory", { id: m.data.id });
    const purged = await call(agent, "delete_memory", {
      id: m.data.id,
      purge: true,
    });
    expect(purged.isError).toBe(false);
    expect(
      (await call(agent, "restore", { type: "memory", id: m.data.id })).isError,
    ).toBe(true);
  });
});

describe("document tools", () => {
  const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(700, 65)]);

  it("creates text from content, returns it inline and lists it", async () => {
    const { agent } = await setup();
    const created = await call(agent, "create_document", {
      project: "Alpha",
      filename: "notes.md",
      description: "Runbook",
      content: "# Hello\n\nworld",
    });
    expect(created.isError).toBe(false);
    expect(created.data).toMatchObject({
      filename: "notes.md",
      mimeType: "text/markdown",
      description: "Runbook",
      createdBy: "agent",
    });
    expect(created.data.markdown).toContain("[notes.md](");

    const got = await call(agent, "get_document", { id: created.data.id });
    expect(got.data.content).toBe("# Hello\n\nworld");
    expect(got.data.url).toContain(`/files/doc/${created.data.id}`);

    const list = await call(agent, "list_documents", {
      project: "Alpha",
      query: "runbook",
    });
    expect(list.data.items).toHaveLength(1);
    expect(list.data.items[0].content).toBeUndefined();
    expect(
      (await call(agent, "list_documents", { project: "Beta" })).data.items,
    ).toEqual([]);
  });

  it("returns binaries as metadata + url only", async () => {
    const { agent } = await setup();
    const created = await call(agent, "create_document", {
      project: "Alpha",
      filename: "spec.pdf",
      contentBase64: PDF.toString("base64"),
    });
    expect(created.data.mimeType).toBe("application/pdf");
    const got = await call(agent, "get_document", { id: created.data.id });
    expect(got.data.content).toBeUndefined();
    expect(got.data.url).toBeTruthy();
    expect(got.data.sizeBytes).toBe(PDF.length);
  });

  it("requires exactly one source and rejects bad base64 and unknown projects", async () => {
    const { agent } = await setup();
    const none = await call(agent, "create_document", {
      project: "Alpha",
      filename: "a.txt",
    });
    expect(none.text).toMatch(/exactly one/);
    const two = await call(agent, "create_document", {
      project: "Alpha",
      filename: "a.txt",
      content: "x",
      contentBase64: "eA==",
    });
    expect(two.isError).toBe(true);
    const bad = await call(agent, "create_document", {
      project: "Alpha",
      filename: "a.txt",
      contentBase64: "!!!",
    });
    expect(bad.text).toMatch(/base64/);
    const unknown = await call(agent, "create_document", {
      project: "Nope",
      filename: "a.txt",
      content: "x",
    });
    expect(unknown.isError).toBe(true);
  });

  it("updates, conflicts, deletes, restores and purges", async () => {
    const { agent } = await setup();
    const d = await call(agent, "create_document", {
      project: "Alpha",
      filename: "a.txt",
      content: "x",
    });
    const upd = await call(agent, "update_document", {
      id: d.data.id,
      filename: "b.txt",
      description: "new",
      expectedUpdatedAt: d.data.updatedAt,
    });
    expect(upd.data).toMatchObject({ filename: "b.txt", description: "new" });

    const stale = await call(agent, "update_document", {
      id: d.data.id,
      description: "z",
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    expect(stale.isError).toBe(true);
    const empty = await call(agent, "update_document", { id: d.data.id });
    expect(empty.text).toMatch(/No fields/);

    await call(agent, "delete_document", { id: d.data.id });
    expect((await call(agent, "get_document", { id: d.data.id })).isError).toBe(
      true,
    );
    expect(
      (await call(agent, "restore", { type: "document", id: d.data.id }))
        .isError,
    ).toBe(false);
    await call(agent, "delete_document", { id: d.data.id });
    expect(
      (await call(agent, "delete_document", { id: d.data.id, purge: true }))
        .isError,
    ).toBe(false);
  });
});
