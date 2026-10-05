import { afterEach, describe, expect, it } from "vitest";
import { call, startMcp } from "./helpers/mcp-client.js";

let app: Awaited<ReturnType<typeof startMcp>>;
afterEach(async () => app.close());

async function setup(env: Record<string, string> = {}) {
  app = await startMcp(env);
  return { agent: await app.connect("agent"), you: await app.connect("you") };
}

describe("project tools", () => {
  it("creates with the default key, lists with issue counts and gets with milestones", async () => {
    const { agent } = await setup();
    const created = await call(agent, "save_project", {
      name: "Alpha",
      description: "# Alpha",
    });
    expect(created.data).toMatchObject({
      key: "MAT",
      name: "Alpha",
      status: "active",
    });

    const project = app.services.projects.get("Alpha");
    const ms = app.services.milestones.create("agent", project.id, {
      name: "M1",
    });
    app.services.issues.create("agent", {
      project: "Alpha",
      title: "a",
      status: "done",
      milestoneId: ms.id,
    });
    app.services.issues.create("agent", {
      project: "Alpha",
      title: "b",
      milestoneId: ms.id,
    });
    app.services.issues.create("agent", {
      project: "Alpha",
      title: "c",
      status: "canceled",
      milestoneId: ms.id,
    });

    const list = await call(agent, "list_projects", { query: "alp" });
    expect(list.data.items).toHaveLength(1);
    expect(list.data.items[0].issueCounts).toEqual({
      backlog: 1,
      todo: 0,
      in_progress: 0,
      in_review: 0,
      done: 1,
      canceled: 1,
    });
    expect(list.data.nextCursor).toBeUndefined();

    const got = await call(agent, "get_project", { project: "Alpha" });
    expect(got.data.description).toBe("# Alpha");
    expect(got.data.milestones).toEqual([
      expect.objectContaining({ name: "M1", progress: { done: 1, total: 2 } }),
    ]);
    const bare = await call(agent, "get_project", {
      project: "Alpha",
      includeMilestones: false,
    });
    expect(bare.data.milestones).toBeUndefined();
  });

  it("updates by id, and refuses to change the key", async () => {
    const { agent } = await setup();
    const { data } = await call(agent, "save_project", {
      name: "Alpha",
      key: "ALP",
    });
    const upd = await call(agent, "save_project", {
      id: data.id,
      status: "paused",
    });
    expect(upd.data.status).toBe("paused");
    const bad = await call(agent, "save_project", { id: data.id, key: "ZZZ" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("cannot be changed");
    expect((await call(agent, "save_project", {})).isError).toBe(true);
  });

  it("lists known projects when a reference is unknown", async () => {
    const { agent } = await setup();
    await call(agent, "save_project", { name: "Alpha", key: "ALP" });
    const res = await call(agent, "get_project", { project: "Nope" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("Known projects: Alpha (ALP)");
  });

  it("paginates with nextCursor", async () => {
    const { agent } = await setup();
    for (const name of ["A", "B", "C"])
      await call(agent, "save_project", { name });
    const p1 = await call(agent, "list_projects", { limit: 2 });
    expect(p1.data.items.map((i: any) => i.name)).toEqual(["A", "B"]);
    const p2 = await call(agent, "list_projects", {
      limit: 2,
      cursor: p1.data.nextCursor,
    });
    expect(p2.data.items.map((i: any) => i.name)).toEqual(["C"]);
    expect(p2.data.nextCursor).toBeUndefined();
    expect((await call(agent, "list_projects", { cursor: "!!" })).isError).toBe(
      true,
    );
  });

  it("soft-deletes, restores, and blocks agent purge without changing data", async () => {
    const { agent, you } = await setup();
    await call(agent, "save_project", { name: "Alpha" });
    const del = await call(agent, "delete_project", { project: "Alpha" });
    expect(del.data).toMatchObject({ type: "project" });
    expect((await call(agent, "list_projects")).data.items).toEqual([]);
    const withDeleted = await call(agent, "list_projects", {
      includeDeleted: true,
    });
    expect(withDeleted.data.items[0].deleted).toBe(true);

    const denied = await call(agent, "delete_project", {
      project: "Alpha",
      purge: true,
    });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/Agents cannot purge by default/);
    expect(
      app.services.projects.get("Alpha", { includeDeleted: true }).deletedAt,
    ).not.toBeNull();

    const restored = await call(agent, "restore", {
      type: "project",
      id: del.data.id,
    });
    expect(restored.data).toMatchObject({ type: "project" });
    expect((await call(agent, "list_projects")).data.items).toHaveLength(1);

    await call(you, "delete_project", { project: "Alpha" });
    const purged = await call(you, "delete_project", {
      project: "Alpha",
      purge: true,
    });
    expect(purged.isError).toBe(false);
    expect(app.services.projects.list({ includeDeleted: true })).toEqual([]);
  });
});

describe("milestone tools", () => {
  it("creates, updates, lists with progress and paginates", async () => {
    const { agent } = await setup();
    await call(agent, "save_project", { name: "Alpha" });
    await call(agent, "save_project", { name: "Beta", key: "BET" });
    const m = await call(agent, "save_milestone", {
      project: "Alpha",
      name: "M1",
      targetDate: "2026-12-01",
    });
    expect(m.data).toMatchObject({
      project: "Alpha",
      name: "M1",
      targetDate: "2026-12-01",
      progress: { done: 0, total: 0 },
    });
    await call(agent, "save_milestone", { project: "Beta", name: "M2" });
    await call(agent, "save_milestone", { project: "Beta", name: "M3" });

    const upd = await call(agent, "save_milestone", {
      id: m.data.id,
      targetDate: null,
      name: "M1b",
    });
    expect(upd.data.name).toBe("M1b");
    expect(upd.data.targetDate).toBeUndefined();

    const one = await call(agent, "list_milestones", { project: "Beta" });
    expect(one.data.items.map((i: any) => i.name)).toEqual(["M2", "M3"]);
    const all1 = await call(agent, "list_milestones", { limit: 2 });
    expect(all1.data.items).toHaveLength(2);
    const all2 = await call(agent, "list_milestones", {
      limit: 2,
      cursor: all1.data.nextCursor,
    });
    expect(all2.data.items).toHaveLength(1);
    expect(all2.data.nextCursor).toBeUndefined();
  });

  it("returns actionable errors", async () => {
    const { agent } = await setup();
    await call(agent, "save_project", { name: "Alpha" });
    const unknown = await call(agent, "save_milestone", {
      project: "Nope",
      name: "x",
    });
    expect(unknown.text).toContain("Known projects: Alpha (MAT)");
    expect((await call(agent, "save_milestone", { name: "x" })).isError).toBe(
      true,
    );
    const m = await call(agent, "save_milestone", {
      project: "Alpha",
      name: "M",
    });
    const moved = await call(agent, "save_milestone", {
      id: m.data.id,
      project: "Alpha",
    });
    expect(moved.isError).toBe(true);
  });

  it("deletes keeping issues, restores, and blocks agent purge", async () => {
    const { agent, you } = await setup();
    await call(agent, "save_project", { name: "Alpha" });
    const m = await call(agent, "save_milestone", {
      project: "Alpha",
      name: "M",
    });
    const issue = app.services.issues.create("agent", {
      project: "Alpha",
      title: "t",
      milestoneId: m.data.id,
    });
    const del = await call(agent, "delete_milestone", { id: m.data.id });
    expect(del.isError).toBe(false);
    expect(app.services.issues.get(issue.id).milestoneId).toBeNull();
    expect((await call(agent, "list_milestones")).data.items).toEqual([]);

    const denied = await call(agent, "delete_milestone", {
      id: m.data.id,
      purge: true,
    });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/Agents cannot purge/);
    expect(
      (await call(agent, "list_milestones", { includeDeleted: true })).data
        .items,
    ).toHaveLength(1);

    const back = await call(agent, "restore", {
      type: "milestone",
      id: m.data.id,
    });
    expect(back.isError).toBe(false);
    await call(you, "delete_milestone", { id: m.data.id });
    expect(
      (await call(you, "delete_milestone", { id: m.data.id, purge: true }))
        .isError,
    ).toBe(false);
  });
});

describe("label tools", () => {
  it("creates global and project labels, lists them, updates, and paginates", async () => {
    const { agent } = await setup();
    await call(agent, "save_project", { name: "Alpha" });
    await call(agent, "save_project", { name: "Beta", key: "BET" });
    const g = await call(agent, "save_issue_label", {
      name: "bug",
      color: "#ff0000",
    });
    expect(g.data).toMatchObject({ name: "bug", color: "#ff0000" });
    expect(g.data.project).toBeUndefined();
    await call(agent, "save_issue_label", {
      name: "alpha-only",
      project: "Alpha",
    });
    await call(agent, "save_issue_label", {
      name: "beta-only",
      project: "Beta",
    });

    const globalOnly = await call(agent, "list_issue_labels");
    expect(globalOnly.data.items.map((i: any) => i.name)).toEqual(["bug"]);
    const alpha = await call(agent, "list_issue_labels", { project: "Alpha" });
    expect(alpha.data.items.map((i: any) => i.name)).toEqual([
      "alpha-only",
      "bug",
    ]);
    expect(alpha.data.items[0].project).toBe("Alpha");

    const p1 = await call(agent, "list_issue_labels", {
      project: "Alpha",
      limit: 1,
    });
    const p2 = await call(agent, "list_issue_labels", {
      project: "Alpha",
      limit: 1,
      cursor: p1.data.nextCursor,
    });
    expect([p1.data.items[0].name, p2.data.items[0].name]).toEqual([
      "alpha-only",
      "bug",
    ]);
    expect(p2.data.nextCursor).toBeUndefined();

    const upd = await call(agent, "save_issue_label", {
      id: g.data.id,
      name: "defect",
    });
    expect(upd.data.name).toBe("defect");
  });

  it("returns actionable errors and has no delete tool", async () => {
    const { agent } = await setup();
    await call(agent, "save_issue_label", { name: "bug" });
    const dup = await call(agent, "save_issue_label", { name: "BUG" });
    expect(dup.isError).toBe(true);
    expect(dup.text).toContain("already exists");
    expect(
      (await call(agent, "save_issue_label", { name: "x", project: "Nope" }))
        .text,
    ).toContain("Known projects");
    expect(
      (await call(agent, "save_issue_label", { name: "x", color: "red" }))
        .isError,
    ).toBe(true);
    const names = (await agent.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("delete_issue_label");
    expect(names).toEqual(
      expect.arrayContaining(["restore", "list_projects", "save_milestone"]),
    );
  });
});
