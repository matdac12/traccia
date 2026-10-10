import { describe, expect, it } from "vitest";
import { createServices } from "../src/service/index.js";
import { createToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

function setup() {
  const t = createTestApp();
  const services = createServices({ db: t.db, defaultIssueKey: "MAT" });
  const project = services.projects.create("you", { name: "P" });
  const agent = createToken(t.db, { name: "a", actor: "agent" });
  const hAgent = { Authorization: `Bearer ${agent.token}` };
  const call = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = hAgent,
  ) =>
    t.app.request(path, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  return { ...t, project, call, hAgent };
}

describe("memories REST", () => {
  it("requires a token", async () => {
    const { app, project } = setup();
    for (const [m, p] of [
      ["GET", `/v1/projects/${project.id}/memories`],
      ["POST", `/v1/projects/${project.id}/memories`],
      ["GET", "/v1/memories/x"],
      ["PATCH", "/v1/memories/x"],
      ["DELETE", "/v1/memories/x"],
    ]) {
      expect((await app.request(p as string, { method: m })).status).toBe(401);
    }
  });

  it("creates, gets, lists, filters, updates and deletes", async () => {
    const { call, project } = setup();
    const base = `/v1/projects/${project.id}/memories`;
    const res = await call("POST", base, {
      title: "Deploy",
      body: "use pnpm",
      tags: ["ops", "ops", "ci"],
    });
    expect(res.status).toBe(201);
    const memory = (await res.json()) as any;
    expect(memory).toMatchObject({
      title: "Deploy",
      tags: ["ops", "ci"],
      createdBy: "agent",
    });

    expect(
      await (await call("GET", `/v1/memories/${memory.id}`)).json(),
    ).toEqual(memory);

    await call("POST", base, { title: "Other", tags: ["x"] });
    const byTag = (await (
      await call("GET", `${base}?tags=ops,ci`)
    ).json()) as any;
    expect(byTag.items.map((m: any) => m.id)).toEqual([memory.id]);
    const byQuery = (await (
      await call("GET", `${base}?query=pnpm`)
    ).json()) as any;
    expect(byQuery.items).toHaveLength(1);
    const paged = (await (await call("GET", `${base}?limit=1`)).json()) as any;
    expect(paged.items).toHaveLength(1);
    expect(paged.nextCursor).toBeTruthy();

    const patched = await call("PATCH", `/v1/memories/${memory.id}`, {
      body: "use npx pnpm",
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as any).body).toBe("use npx pnpm");

    const del = await call("DELETE", `/v1/memories/${memory.id}`);
    expect(await del.json()).toMatchObject({
      id: memory.id,
      deleted: true,
      purged: false,
    });
    expect((await call("GET", `/v1/memories/${memory.id}`)).status).toBe(404);
    const withDeleted = (await (
      await call("GET", `${base}?includeDeleted=true&query=pnpm`)
    ).json()) as any;
    expect(withDeleted.items[0]).toMatchObject({
      id: memory.id,
      deleted: true,
    });
  });

  it("returns 409 with currentUpdatedAt on a stale write (body and If-Match)", async () => {
    const { call, hAgent, project } = setup();
    const m = (await (
      await call("POST", `/v1/projects/${project.id}/memories`, { title: "T" })
    ).json()) as any;
    const stale = await call("PATCH", `/v1/memories/${m.id}`, {
      title: "U",
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as any).error.details.currentUpdatedAt).toBe(
      m.updatedAt,
    );
    const viaHeader = await call(
      "PATCH",
      `/v1/memories/${m.id}`,
      { title: "U" },
      {
        ...hAgent,
        "If-Match": '"2000-01-01T00:00:00.000Z"',
      },
    );
    expect(viaHeader.status).toBe(409);
  });

  it("validates input", async () => {
    const { call, project } = setup();
    const base = `/v1/projects/${project.id}/memories`;
    expect((await call("POST", base, { body: "no title" })).status).toBe(400);
    expect((await call("POST", base, { title: "" })).status).toBe(400);
    expect(
      (await call("POST", "/v1/projects/nope/memories", { title: "t" })).status,
    ).toBe(404);
    expect((await call("GET", `${base}?cursor=%%%`)).status).toBe(400);
    const m = (await (await call("POST", base, { title: "T" })).json()) as any;
    expect((await call("PATCH", `/v1/memories/${m.id}`, {})).status).toBe(400);
  });

  it("purges only after soft delete, and restores via /v1/restore and /v1/trash", async () => {
    const { call, project } = setup();
    const m = (await (
      await call("POST", `/v1/projects/${project.id}/memories`, { title: "T" })
    ).json()) as any;
    expect(
      (await call("DELETE", `/v1/memories/${m.id}?purge=true`)).status,
    ).toBe(409);
    await call("DELETE", `/v1/memories/${m.id}`);
    const trash = (await (
      await call("GET", "/v1/trash?type=memory")
    ).json()) as any;
    expect(trash.items.map((i: any) => i.id)).toEqual([m.id]);
    const restored = await call("POST", "/v1/restore", {
      type: "memory",
      id: m.id,
    });
    expect(restored.status).toBe(200);
    expect((await call("GET", `/v1/memories/${m.id}`)).status).toBe(200);
    await call("DELETE", `/v1/memories/${m.id}`);
    const purged = await call("DELETE", `/v1/memories/${m.id}?purge=true`);
    expect(await purged.json()).toMatchObject({ purged: true });
  });
});
