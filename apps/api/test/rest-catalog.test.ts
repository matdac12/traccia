import { describe, expect, it } from "vitest";
import { createServices } from "../src/service/index.js";
import { createToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

function setup(env: Record<string, string> = {}) {
  const t = createTestApp(env);
  const services = createServices({ db: t.db, defaultIssueKey: "MAT" });
  const agent = createToken(t.db, { name: "a", actor: "agent" });
  const you = createToken(t.db, { name: "y", actor: "you" });
  const hAgent = { Authorization: `Bearer ${agent.token}` };
  const hYou = { Authorization: `Bearer ${you.token}` };
  const call = (
    method: string,
    path: string,
    opts: { body?: unknown; headers?: Record<string, string> } = {},
  ) =>
    t.app.request(path, {
      method,
      headers: {
        ...(opts.headers ?? hAgent),
        ...(opts.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  return { ...t, services, hAgent, hYou, call };
}

describe("auth", () => {
  it("requires a token on every route", async () => {
    const { app } = setup();
    for (const [m, p] of [
      ["GET", "/v1/projects"],
      ["POST", "/v1/projects"],
      ["GET", "/v1/projects/x"],
      ["PATCH", "/v1/projects/x"],
      ["DELETE", "/v1/projects/x"],
      ["GET", "/v1/projects/x/milestones"],
      ["POST", "/v1/projects/x/milestones"],
      ["GET", "/v1/milestones/x"],
      ["PATCH", "/v1/milestones/x"],
      ["DELETE", "/v1/milestones/x"],
      ["GET", "/v1/labels"],
      ["POST", "/v1/labels"],
      ["PATCH", "/v1/labels/x"],
      ["DELETE", "/v1/labels/x"],
      ["POST", "/v1/restore"],
    ]) {
      const res = await app.request(p as string, { method: m as string });
      expect(res.status, `${m} ${p}`).toBe(401);
    }
  });
});

describe("projects", () => {
  it("creates, stamps the actor, gets and updates", async () => {
    const { call, hYou } = setup();
    const res = await call("POST", "/v1/projects", {
      body: { name: "Alpha" },
      headers: hYou,
    });
    expect(res.status).toBe(201);
    const p = (await res.json()) as any;
    expect(p).toMatchObject({ name: "Alpha", createdBy: "you", key: "MAT" });
    expect(p.issueCounts).toEqual({
      backlog: 0,
      todo: 0,
      in_progress: 0,
      in_review: 0,
      done: 0,
      canceled: 0,
    });
    const got = (await (
      await call("GET", `/v1/projects/${p.id}`)
    ).json()) as any;
    expect(got.id).toBe(p.id);
    const upd = await call("PATCH", `/v1/projects/${p.id}`, {
      body: { status: "paused" },
    });
    expect(((await upd.json()) as any).status).toBe("paused");
  });

  it("agent actor is stamped", async () => {
    const { call } = setup();
    const p = (await (
      await call("POST", "/v1/projects", { body: { name: "A" } })
    ).json()) as any;
    expect(p.createdBy).toBe("agent");
  });

  it("includes per-status issue counts", async () => {
    const { call, services } = setup();
    const p = services.projects.create("you", { name: "P" });
    services.issues.create("you", { project: p.id, title: "a" });
    services.issues.create("you", {
      project: p.id,
      title: "b",
      status: "done",
    });
    const gone = services.issues.create("you", { project: p.id, title: "c" });
    await services.trash.delete("you", "issue", gone.id);
    const got = (await (
      await call("GET", `/v1/projects/${p.id}`)
    ).json()) as any;
    expect(got.issueCounts).toMatchObject({ backlog: 1, done: 1, todo: 0 });
  });

  it("lists with status filter, includeDeleted and pagination", async () => {
    const { call, services } = setup();
    const a = services.projects.create("you", { name: "A" });
    services.projects.create("you", { name: "B", status: "paused" });
    const c = services.projects.create("you", { name: "C" });
    await services.trash.delete("you", "project", c.id);

    const names = async (q: string) =>
      ((await (await call("GET", `/v1/projects${q}`)).json()) as any).items.map(
        (p: any) => p.name,
      );
    expect(await names("")).toEqual(["A", "B"]);
    expect(await names("?status=paused")).toEqual(["B"]);
    expect(await names("?includeDeleted=true")).toEqual(["A", "B", "C"]);

    const p1 = (await (
      await call("GET", "/v1/projects?limit=1")
    ).json()) as any;
    expect(p1.items[0].id).toBe(a.id);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await (
      await call("GET", `/v1/projects?limit=1&cursor=${p1.nextCursor}`)
    ).json()) as any;
    expect(p2.items.map((p: any) => p.name)).toEqual(["B"]);
    expect(p2.nextCursor).toBeNull();
  });

  it("rejects bad input with validation_error", async () => {
    const { call } = setup();
    for (const res of [
      await call("POST", "/v1/projects", { body: { name: "" } }),
      await call("GET", "/v1/projects?status=nope"),
      await call("GET", "/v1/projects?includeDeleted=maybe"),
      await call("GET", "/v1/projects?cursor=!!!"),
    ]) {
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error.code).toBe("validation_error");
    }
  });

  it("returns 404 for unknown projects", async () => {
    const { call } = setup();
    for (const [m, body] of [
      ["GET", undefined],
      ["PATCH", { name: "x" }],
      ["DELETE", undefined],
    ] as const) {
      const res = await call(m, "/v1/projects/nope", { body });
      expect(res.status).toBe(404);
      expect(((await res.json()) as any).error.code).toBe("not_found");
    }
  });

  it("soft deletes, then purge needs `you` and a deleted item", async () => {
    const { call, hYou, services } = setup();
    const p = services.projects.create("you", { name: "P" });
    // Purging a live project conflicts.
    const live = await call("DELETE", `/v1/projects/${p.id}?purge=true`, {
      headers: hYou,
    });
    expect(live.status).toBe(409);

    const del = await call("DELETE", `/v1/projects/${p.id}`);
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({ deleted: true, purged: false });
    expect((await call("GET", `/v1/projects/${p.id}`)).status).toBe(404);
    expect(
      (await call("GET", `/v1/projects/${p.id}?includeDeleted=true`)).status,
    ).toBe(200);

    const agentPurge = await call("DELETE", `/v1/projects/${p.id}?purge=true`);
    expect(agentPurge.status).toBe(403);
    expect(((await agentPurge.json()) as any).error.code).toBe("forbidden");

    const purged = await call("DELETE", `/v1/projects/${p.id}?purge=true`, {
      headers: hYou,
    });
    expect(purged.status).toBe(200);
    expect(await purged.json()).toMatchObject({ deleted: true, purged: true });
    expect(
      (await call("GET", `/v1/projects/${p.id}?includeDeleted=true`)).status,
    ).toBe(404);
  });

  it("lets agents purge when ALLOW_AGENT_PURGE is set", async () => {
    const { call, services } = setup({ ALLOW_AGENT_PURGE: "true" });
    const p = services.projects.create("you", { name: "P" });
    await services.trash.delete("you", "project", p.id);
    const res = await call("DELETE", `/v1/projects/${p.id}?purge=true`);
    expect(res.status).toBe(200);
  });
});

describe("milestones", () => {
  it("creates under a project, stamps the actor, and reports progress", async () => {
    const { call, services } = setup();
    const p = services.projects.create("you", { name: "P" });
    const res = await call("POST", `/v1/projects/${p.id}/milestones`, {
      body: { name: "M1", targetDate: "2026-12-01" },
    });
    expect(res.status).toBe(201);
    const m = (await res.json()) as any;
    expect(m).toMatchObject({
      name: "M1",
      createdBy: "agent",
      projectId: p.id,
      progress: { done: 0, total: 0 },
    });

    services.issues.create("you", {
      project: p.id,
      title: "a",
      milestoneId: m.id,
    });
    services.issues.create("you", {
      project: p.id,
      title: "b",
      milestoneId: m.id,
      status: "done",
    });
    services.issues.create("you", {
      project: p.id,
      title: "c",
      milestoneId: m.id,
      status: "canceled",
    });
    const got = (await (
      await call("GET", `/v1/milestones/${m.id}`)
    ).json()) as any;
    expect(got.progress).toEqual({ done: 1, total: 2 });

    const upd = await call("PATCH", `/v1/milestones/${m.id}`, {
      body: { name: "M1b", targetDate: null },
    });
    expect(await upd.json()).toMatchObject({ name: "M1b", targetDate: null });
  });

  it("lists with pagination and progress", async () => {
    const { call, services } = setup();
    const p = services.projects.create("you", { name: "P" });
    services.milestones.create("you", p.id, { name: "A", sortOrder: 1 });
    services.milestones.create("you", p.id, { name: "B", sortOrder: 2 });
    const r1 = (await (
      await call("GET", `/v1/projects/${p.id}/milestones?limit=1`)
    ).json()) as any;
    expect(r1.items).toHaveLength(1);
    expect(r1.items[0].progress).toEqual({ done: 0, total: 0 });
    const r2 = (await (
      await call(
        "GET",
        `/v1/projects/${p.id}/milestones?limit=1&cursor=${r1.nextCursor}`,
      )
    ).json()) as any;
    expect(r2.items[0].name).toBe("B");
    expect(r2.nextCursor).toBeNull();
  });

  it("404s and validates", async () => {
    const { call, services } = setup();
    const p = services.projects.create("you", { name: "P" });
    expect((await call("GET", "/v1/milestones/nope")).status).toBe(404);
    expect((await call("GET", "/v1/projects/nope/milestones")).status).toBe(
      404,
    );
    expect(
      (
        await call("POST", "/v1/projects/nope/milestones", {
          body: { name: "x" },
        })
      ).status,
    ).toBe(404);
    const bad = await call("POST", `/v1/projects/${p.id}/milestones`, {
      body: { name: "x", targetDate: "2026-02-30" },
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error.code).toBe("validation_error");
  });

  it("delete and purge follow the trash rules", async () => {
    const { call, hYou, services } = setup();
    const p = services.projects.create("you", { name: "P" });
    const m = services.milestones.create("you", p.id, { name: "M" });
    expect((await call("DELETE", `/v1/milestones/${m.id}`)).status).toBe(200);
    expect((await call("GET", `/v1/milestones/${m.id}`)).status).toBe(404);
    expect(
      (await call("DELETE", `/v1/milestones/${m.id}?purge=true`)).status,
    ).toBe(403);
    const ok = await call("DELETE", `/v1/milestones/${m.id}?purge=true`, {
      headers: hYou,
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ purged: true });
  });
});

describe("labels", () => {
  it("creates global and project labels, lists and filters", async () => {
    const { call, services } = setup();
    const p = services.projects.create("you", { name: "P" });
    const g = await call("POST", "/v1/labels", {
      body: { name: "bug", color: "#ff0000" },
    });
    expect(g.status).toBe(201);
    expect(await g.json()).toMatchObject({ name: "bug", projectId: null });
    const s = await call("POST", "/v1/labels", {
      body: { name: "ui", project: p.id },
    });
    expect(((await s.json()) as any).projectId).toBe(p.id);

    const names = async (q: string) =>
      ((await (await call("GET", `/v1/labels${q}`)).json()) as any).items.map(
        (l: any) => l.name,
      );
    expect(await names("")).toEqual(["bug"]);
    expect(await names(`?project=${p.id}`)).toEqual(["bug", "ui"]);
    const page = (await (
      await call("GET", "/v1/labels?limit=1&project=" + p.id)
    ).json()) as any;
    expect(page.nextCursor).toBeTruthy();
  });

  it("updates, conflicts on duplicate names, validates, 404s", async () => {
    const { call, services } = setup();
    const a = services.labels.create({ name: "a" });
    services.labels.create({ name: "b" });
    const upd = await call("PATCH", `/v1/labels/${a.id}`, {
      body: { color: "#00ff00" },
    });
    expect(await upd.json()).toMatchObject({ color: "#00ff00" });
    const dup = await call("PATCH", `/v1/labels/${a.id}`, {
      body: { name: "B" },
    });
    expect(dup.status).toBe(409);
    const bad = await call("POST", "/v1/labels", {
      body: { name: "x", color: "red" },
    });
    expect(bad.status).toBe(400);
    expect(
      (await call("PATCH", "/v1/labels/nope", { body: { name: "q" } })).status,
    ).toBe(404);
    expect((await call("DELETE", "/v1/labels/nope")).status).toBe(404);
  });

  it("deletes over REST, hiding it unless includeDeleted", async () => {
    const { call, services } = setup();
    const l = services.labels.create({ name: "gone" });
    const res = await call("DELETE", `/v1/labels/${l.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: l.id, deleted: true });
    const list = (await (await call("GET", "/v1/labels")).json()) as any;
    expect(list.items).toEqual([]);
    const all = (await (
      await call("GET", "/v1/labels?includeDeleted=true")
    ).json()) as any;
    expect(all.items).toHaveLength(1);
  });
});

describe("restore", () => {
  it("restores a deleted project and its batch", async () => {
    const { call, services } = setup();
    const p = services.projects.create("you", { name: "P" });
    const i = services.issues.create("you", { project: p.id, title: "t" });
    await services.trash.delete("you", "project", p.id);
    const res = await call("POST", "/v1/restore", {
      body: { type: "project", id: p.id },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ type: "project", id: p.id });
    expect((await call("GET", `/v1/projects/${p.id}`)).status).toBe(200);
    expect(services.issues.get(i.id).id).toBe(i.id);
  });

  it("restores milestones and issues", async () => {
    const { call, services } = setup();
    const p = services.projects.create("you", { name: "P" });
    const m = services.milestones.create("you", p.id, { name: "M" });
    const i = services.issues.create("you", { project: p.id, title: "t" });
    await services.trash.delete("you", "milestone", m.id);
    await services.trash.delete("you", "issue", i.id);
    for (const [type, id] of [
      ["milestone", m.id],
      ["issue", i.id],
    ]) {
      expect(
        (await call("POST", "/v1/restore", { body: { type, id } })).status,
      ).toBe(200);
    }
    expect((await call("GET", `/v1/milestones/${m.id}`)).status).toBe(200);
  });

  it("restores a deleted comment", async () => {
    const { call, services } = setup();
    const p = services.projects.create("you", { name: "P" });
    const i = services.issues.create("you", { project: p.id, title: "t" });
    const cm = services.comments.create("you", i.id, { body: "hi" });
    await services.trash.delete("you", "comment", cm.id);
    const res = await call("POST", "/v1/restore", {
      body: { type: "comment", id: cm.id },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ type: "comment", id: cm.id });
  });

  it("validates type and 404s on unknown ids", async () => {
    const { call } = setup();
    const bad = await call("POST", "/v1/restore", {
      body: { type: "label", id: "x" },
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error.code).toBe("validation_error");
    const missing = await call("POST", "/v1/restore", {
      body: { type: "project", id: "nope" },
    });
    expect(missing.status).toBe(404);
  });
});
