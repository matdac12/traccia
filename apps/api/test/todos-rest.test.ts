import { RESTORE_TYPES, REST_RESTORE_TYPES, todoSchema } from "@traccia/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todoReferences } from "../src/db/schema.js";
import { createServices } from "../src/service/index.js";
import { createToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

function setup() {
  const t = createTestApp({ BASE_URL: "https://traccia.example.ts.net/" });
  const parla = createToken(t.db, { name: "parla", actor: "you" });
  const call = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    t.app.request(path, {
      method,
      headers: {
        ...headers,
        Authorization: `Bearer ${parla.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  const json = async (res: Response) => (await res.json()) as any;
  return { ...t, call, json, token: parla.token };
}

const makeProject = (db: ReturnType<typeof setup>["db"], key: string) =>
  createServices({ db, defaultIssueKey: "MAT" }).projects.create("you", {
    name: key,
    key,
  });

describe("POST /v1/todos", () => {
  it("creates a To-do with the token as source and a dashboard url", async () => {
    const { call, json } = setup();
    const res = await call("POST", "/v1/todos", {
      title: "Gym",
      day: "2026-10-20",
    });
    expect(res.status).toBe(201);
    const todo = await json(res);
    expect(todoSchema.parse(todo)).toEqual(todo);
    expect(todo).toMatchObject({
      title: "Gym",
      day: "2026-10-20",
      state: "open",
      source: "parla",
      references: [],
      reminder: null,
      parentId: null,
      details: null,
      url: `https://traccia.example.ts.net/personal?todo=${todo.id}`,
    });
  });

  it.each([
    ["an empty title", { title: "" }, "title"],
    ["a 501-character title", { title: "x".repeat(501) }, "title"],
    ["a malformed day", { title: "a", day: "2026-10-2" }, "day"],
    ["an impossible day", { title: "a", day: "2026-02-30" }, "day"],
  ])("refuses %s with validation_error", async (_, body, field) => {
    const { call, json } = setup();
    const res = await call("POST", "/v1/todos", body);
    expect(res.status).toBe(400);
    const { error } = await json(res);
    expect(error.code).toBe("validation_error");
    expect(error.details.fields).toHaveProperty(field);
  });

  it("refuses a body that is not JSON", async () => {
    const { app, json, token } = setup();
    const res = await app.request("/v1/todos", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: "Gym tomorrow",
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("validation_error");
  });
});

describe("GET /v1/todos", () => {
  it("lists open To-dos by day, Anytime last, new ones at the bottom of their bucket", async () => {
    const { call, json } = setup();
    for (const body of [
      { title: "anytime" },
      { title: "tue first", day: "2026-10-20" },
      { title: "mon", day: "2026-10-19" },
      { title: "tue second", day: "2026-10-20" },
    ]) {
      expect((await call("POST", "/v1/todos", body)).status).toBe(201);
    }
    const res = await call("GET", "/v1/todos?state=open");
    expect(res.status).toBe(200);
    const page = await json(res);
    expect(page.items.map((t: any) => t.title)).toEqual([
      "mon",
      "tue first",
      "tue second",
      "anytime",
    ]);
    expect(page.nextCursor).toBeNull();
    for (const t of page.items) {
      expect(t.url).toBe(
        `https://traccia.example.ts.net/personal?todo=${t.id}`,
      );
    }
  });

  it("pages with limit and cursor", async () => {
    const { call, json } = setup();
    for (const title of ["a", "b", "c"])
      await call("POST", "/v1/todos", { title });
    const first = await json(await call("GET", "/v1/todos?state=open&limit=2"));
    expect(first.items).toHaveLength(2);
    const second = await json(
      await call(
        "GET",
        `/v1/todos?state=open&limit=2&cursor=${first.nextCursor}`,
      ),
    );
    expect(second.items.map((t: any) => t.title)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
  });

  it("returns the Logbook for state=closed", async () => {
    const { call, json, sqlite } = setup();
    const todo = await json(await call("POST", "/v1/todos", { title: "done" }));
    await call("POST", "/v1/todos", { title: "open" });
    sqlite
      .prepare("UPDATE todos SET state = 'done', closed_at = ? WHERE id = ?")
      .run("2026-10-17T09:00:00.000Z", todo.id);
    const page = await json(await call("GET", "/v1/todos?state=closed"));
    expect(page.items.map((t: any) => [t.title, t.closedAt])).toEqual([
      ["done", "2026-10-17T09:00:00.000Z"],
    ]);
  });

  it.each([
    ["no state", "/v1/todos", "state"],
    ["an unknown state", "/v1/todos?state=later", "state"],
    ["a bad limit", "/v1/todos?state=open&limit=0", "limit"],
    [
      "a bad includeDeleted",
      "/v1/todos?state=open&includeDeleted=yes",
      "includeDeleted",
    ],
    ["a bad cursor", "/v1/todos?state=open&cursor=!!!", "cursor"],
  ])("refuses %s with validation_error", async (_, path, field) => {
    const { call, json } = setup();
    const res = await call("GET", path);
    expect(res.status).toBe(400);
    const { error } = await json(res);
    expect(error.code).toBe("validation_error");
    expect(error.details.fields).toHaveProperty(field);
  });
});

describe("GET /v1/todos/:id", () => {
  it("returns one To-do, or 404", async () => {
    const { call, json } = setup();
    const created = await json(await call("POST", "/v1/todos", { title: "a" }));
    const res = await call("GET", `/v1/todos/${created.id}`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual(created);
    const missing = await call("GET", "/v1/todos/nope");
    expect(missing.status).toBe(404);
    expect((await json(missing)).error.code).toBe("not_found");
  });
});

describe("POST /v1/todos with parentId", () => {
  it("creates a Sub-to-do, and refuses a Sub-to-do, closed or unknown parent with 400", async () => {
    const { call, json } = setup();
    const parent = await json(await call("POST", "/v1/todos", { title: "p" }));
    const res = await call("POST", "/v1/todos", {
      title: "s",
      parentId: parent.id,
    });
    expect(res.status).toBe(201);
    const sub = await json(res);
    expect(todoSchema.parse(sub)).toEqual(sub);
    expect(sub.parentId).toBe(parent.id);

    const closed = await json(await call("POST", "/v1/todos", { title: "c" }));
    await call("PATCH", `/v1/todos/${closed.id}`, { state: "done" });
    for (const parentId of [sub.id, closed.id, "nope"]) {
      const bad = await call("POST", "/v1/todos", { title: "x", parentId });
      expect(bad.status, parentId).toBe(400);
      const { error } = await json(bad);
      expect(error.code).toBe("validation_error");
      expect(error.details.fields).toHaveProperty("parentId");
    }
  });
});

describe("PATCH /v1/todos/:id", () => {
  const make = async (
    t: ReturnType<typeof setup>,
    body: Record<string, unknown> = { title: "a" },
  ) => t.json(await t.call("POST", "/v1/todos", body));

  it("edits the To-do and returns it with its url", async () => {
    const t = setup();
    const todo = await make(t, { title: "a", day: "2026-10-20" });
    const res = await t.call("PATCH", `/v1/todos/${todo.id}`, {
      title: "b",
      day: null,
      details: "notes",
    });
    expect(res.status).toBe(200);
    const updated = await t.json(res);
    expect(todoSchema.parse(updated)).toEqual(updated);
    expect(updated).toMatchObject({
      title: "b",
      day: null,
      details: "notes",
      url: todo.url,
    });
  });

  it("re-derives references from a new title", async () => {
    const t = setup();
    const crm = createServices({
      db: t.db,
      defaultIssueKey: "MAT",
    }).projects.create("you", { name: "CRM", key: "CRM" });
    const todo = await make(t);
    const updated = await t.json(
      await t.call("PATCH", `/v1/todos/${todo.id}`, { title: "ship @crm" }),
    );
    expect(updated.references).toEqual([
      { key: "CRM", projectId: crm.id, projectDeleted: false },
    ]);
  });

  it.each([
    ["an empty patch", {}, "No fields to update"],
    ["only closeSubTodos", { closeSubTodos: true }, "No fields to update"],
  ])("refuses %s with 400", async (_, body, message) => {
    const t = setup();
    const todo = await make(t);
    const res = await t.call("PATCH", `/v1/todos/${todo.id}`, body);
    expect(res.status).toBe(400);
    const { error } = await t.json(res);
    expect(error).toMatchObject({ code: "validation_error", message });
  });

  it.each([
    ["an empty title", { title: " " }, "title"],
    ["a malformed day", { day: "tomorrow" }, "day"],
    ["an unknown state", { state: "finished" }, "state"],
  ])("refuses %s with validation_error", async (_, body, field) => {
    const t = setup();
    const todo = await make(t);
    const res = await t.call("PATCH", `/v1/todos/${todo.id}`, body);
    expect(res.status).toBe(400);
    expect((await t.json(res)).error.details.fields).toHaveProperty(field);
  });

  it("is 404 for an unknown To-do", async () => {
    const t = setup();
    const res = await t.call("PATCH", "/v1/todos/nope", { title: "x" });
    expect(res.status).toBe(404);
  });

  it("is 409 conflict with currentUpdatedAt for a stale expectedUpdatedAt or If-Match", async () => {
    const t = setup();
    const todo = await make(t);
    await new Promise((r) => setTimeout(r, 5));
    const first = await t.json(
      await t.call("PATCH", `/v1/todos/${todo.id}`, {
        title: "b",
        expectedUpdatedAt: todo.updatedAt,
      }),
    );
    const byBody = await t.call("PATCH", `/v1/todos/${todo.id}`, {
      title: "c",
      expectedUpdatedAt: todo.updatedAt,
    });
    expect(byBody.status).toBe(409);
    const { error } = await t.json(byBody);
    expect(error.code).toBe("conflict");
    expect(error.details).toEqual({ currentUpdatedAt: first.updatedAt });

    const byHeader = await t.call(
      "PATCH",
      `/v1/todos/${todo.id}`,
      { title: "c" },
      { "If-Match": `"${todo.updatedAt}"` },
    );
    expect(byHeader.status).toBe(409);
    expect((await t.json(byHeader)).error.details).toEqual({
      currentUpdatedAt: first.updatedAt,
    });

    const fresh = await t.call(
      "PATCH",
      `/v1/todos/${todo.id}`,
      { title: "c" },
      { "If-Match": `"${first.updatedAt}"` },
    );
    expect(fresh.status).toBe(200);
    // The body field wins over the header.
    const both = await t.call(
      "PATCH",
      `/v1/todos/${todo.id}`,
      { title: "d", expectedUpdatedAt: (await t.json(fresh)).updatedAt },
      { "If-Match": '"stale"' },
    );
    expect(both.status).toBe(200);
  });

  it("closes with the cascade: 409 openSubTodos, then closeSubTodos closes all", async () => {
    const t = setup();
    const parent = await make(t, { title: "p" });
    const s1 = await make(t, { title: "s1", parentId: parent.id });
    const s2 = await make(t, { title: "s2", parentId: parent.id });

    const refused = await t.call("PATCH", `/v1/todos/${parent.id}`, {
      state: "done",
    });
    expect(refused.status).toBe(409);
    const { error } = await t.json(refused);
    expect(error.code).toBe("conflict");
    expect(error.details).toEqual({ openSubTodos: 2 });

    const res = await t.call("PATCH", `/v1/todos/${parent.id}`, {
      state: "done",
      closeSubTodos: true,
    });
    expect(res.status).toBe(200);
    const done = await t.json(res);
    expect(done.closedAt).not.toBeNull();
    for (const sub of [s1, s2]) {
      const got = await t.json(await t.call("GET", `/v1/todos/${sub.id}`));
      expect(got).toMatchObject({ state: "done", closedAt: done.closedAt });
    }
    const logbook = await t.json(await t.call("GET", "/v1/todos?state=closed"));
    expect(logbook.items).toHaveLength(3);
    expect(
      (await t.json(await t.call("GET", "/v1/todos?state=open"))).items,
    ).toEqual([]);
  });

  it("reopens a To-do and clears closedAt", async () => {
    const t = setup();
    const todo = await make(t);
    await t.call("PATCH", `/v1/todos/${todo.id}`, { state: "dropped" });
    const reopened = await t.json(
      await t.call("PATCH", `/v1/todos/${todo.id}`, { state: "open" }),
    );
    expect(reopened).toMatchObject({ state: "open", closedAt: null });
  });
});

describe("Project references", () => {
  it("resolves @crm to CRM and keeps the title; an unknown key is still 201", async () => {
    const { call, json, db } = setup();
    const crm = makeProject(db, "CRM");
    const res = await call("POST", "/v1/todos", { title: "Work on @crm UI" });
    expect(res.status).toBe(201);
    const todo = await json(res);
    expect(todoSchema.parse(todo)).toEqual(todo);
    expect(todo.title).toBe("Work on @crm UI");
    expect(todo.references).toEqual([
      { key: "CRM", projectId: crm.id, projectDeleted: false },
    ]);

    const unknown = await call("POST", "/v1/todos", {
      title: "Check @CMR export",
    });
    expect(unknown.status).toBe(201);
    expect((await json(unknown)).references).toEqual([]);
  });

  it("returns the references on get and list", async () => {
    const { call, json, db } = setup();
    const crm = makeProject(db, "CRM");
    const created = await json(
      await call("POST", "/v1/todos", { title: "@CRM" }),
    );
    const expected = [{ key: "CRM", projectId: crm.id, projectDeleted: false }];
    expect(
      (await json(await call("GET", `/v1/todos/${created.id}`))).references,
    ).toEqual(expected);
    const list = await json(await call("GET", "/v1/todos?state=open"));
    expect(list.items[0].references).toEqual(expected);
  });
});

describe("DELETE /v1/todos/:id, restore and purge", () => {
  async function withSub() {
    const s = setup();
    const crm = makeProject(s.db, "CRM");
    const parent = await s.json(
      await s.call("POST", "/v1/todos", { title: "Plan @CRM" }),
    );
    const sub = await s.json(
      await s.call("POST", "/v1/todos", { title: "Sub", parentId: parent.id }),
    );
    return { ...s, crm, parent, sub };
  }

  it("soft-deletes the To-do and its Sub-to-dos, and restore brings them back", async () => {
    const { call, json, parent, sub } = await withSub();
    const res = await call("DELETE", `/v1/todos/${parent.id}`);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      type: "todo",
      id: parent.id,
      title: "Plan @CRM",
      counts: { todos: 2 },
      purged: false,
    });
    expect(
      (await json(await call("GET", "/v1/todos?state=open"))).items,
    ).toEqual([]);
    const withDeleted = await json(
      await call("GET", "/v1/todos?state=open&includeDeleted=true"),
    );
    expect(withDeleted.items.map((t: any) => [t.id, t.deleted]).sort()).toEqual(
      [parent.id, sub.id].map((id) => [id, true]).sort(),
    );
    expect(
      (await json(await call("GET", `/v1/todos/${sub.id}`))).deleted,
    ).toBe(true);
    const trash = await json(await call("GET", "/v1/trash?type=todo"));
    expect(trash.items.map((i: any) => i.id).sort()).toEqual(
      [parent.id, sub.id].sort(),
    );

    const restored = await call("POST", "/v1/restore", {
      type: "todo",
      id: parent.id,
    });
    expect(restored.status).toBe(200);
    expect(await json(restored)).toMatchObject({
      type: "todo",
      counts: { todos: 2 },
    });
    const open = await json(await call("GET", "/v1/todos?state=open"));
    expect(open.items).toHaveLength(2);
    expect(open.items.some((t: any) => "deleted" in t)).toBe(false);
    expect(open.items.find((t: any) => t.id === parent.id).references).toEqual(
      [{ key: "CRM", projectId: expect.any(String), projectDeleted: false }],
    );
  });

  it("purges a deleted To-do for good, references included", async () => {
    const { call, json, db, parent, sub } = await withSub();
    const early = await call("DELETE", `/v1/todos/${parent.id}?purge=true`);
    expect(early.status).toBe(409);
    await call("DELETE", `/v1/todos/${parent.id}`);
    const res = await call("DELETE", `/v1/todos/${parent.id}?purge=true`);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      type: "todo",
      id: parent.id,
      counts: { todos: 2 },
      purged: true,
    });
    expect((await call("GET", `/v1/todos/${parent.id}`)).status).toBe(404);
    expect((await call("GET", `/v1/todos/${sub.id}`)).status).toBe(404);
    expect(db.select().from(todoReferences).all()).toEqual([]);
    expect((await json(await call("GET", "/v1/trash"))).items).toEqual([]);
  });

  it("is not_found for an unknown or already deleted To-do", async () => {
    const { call, parent } = await withSub();
    expect((await call("DELETE", "/v1/todos/nope")).status).toBe(404);
    await call("DELETE", `/v1/todos/${parent.id}`);
    expect((await call("DELETE", `/v1/todos/${parent.id}`)).status).toBe(404);
    expect(
      (await call("POST", "/v1/restore", { type: "todo", id: "nope" })).status,
    ).toBe(404);
  });

  it("refuses to restore a Sub-to-do while its parent is deleted", async () => {
    const { call, parent, sub } = await withSub();
    await call("DELETE", `/v1/todos/${parent.id}`);
    const res = await call("POST", "/v1/restore", { type: "todo", id: sub.id });
    expect(res.status).toBe(409);
  });

  it("does not let an agent purge, whoever deleted the To-do", async () => {
    const s = setup();
    const agent = createToken(s.db, { name: "bot", actor: "agent" });
    const created = await s.json(
      await s.call("POST", "/v1/todos", { title: "x" }),
    );
    const asAgent = (path: string) =>
      s.app.request(path, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${agent.token}` },
      });
    expect((await asAgent(`/v1/todos/${created.id}`)).status).toBe(200);
    expect(
      (await asAgent(`/v1/todos/${created.id}?purge=true`)).status,
    ).toBe(403);
    expect((await s.call("GET", `/v1/todos/${created.id}`)).status).toBe(200);
  });

  it("keeps To-dos out of the MCP restore tool", () => {
    expect(RESTORE_TYPES).not.toContain("todo");
    expect(REST_RESTORE_TYPES).toContain("todo");
  });
});

describe("PATCH /v1/todos/:id/position", () => {
  const make = async (
    t: ReturnType<typeof setup>,
    title: string,
    extra: Record<string, unknown> = {},
  ) =>
    t.json(
      await t.call("POST", "/v1/todos", { title, day: "2026-10-20", ...extra }),
    );
  const titles = async (t: ReturnType<typeof setup>) =>
    (await t.json(await t.call("GET", "/v1/todos?state=open"))).items.map(
      (i: any) => i.title,
    );

  it("moves a To-do between two others in GET ?state=open order", async () => {
    const t = setup();
    const a = await make(t, "a");
    const b = await make(t, "b");
    const c = await make(t, "c");
    const res = await t.call("PATCH", `/v1/todos/${c.id}/position`, {
      afterId: a.id,
      beforeId: b.id,
    });
    expect(res.status).toBe(200);
    const moved = await t.json(res);
    expect(todoSchema.parse(moved)).toEqual(moved);
    expect(moved).toMatchObject({ id: c.id, url: c.url });
    expect(await titles(t)).toEqual(["a", "c", "b"]);
  });

  it("sends a To-do with no neighbour to the bottom of its bucket", async () => {
    const t = setup();
    const a = await make(t, "a");
    await make(t, "b");
    await t.call("PATCH", `/v1/todos/${a.id}/position`, {});
    expect(await titles(t)).toEqual(["b", "a"]);
  });

  it("is 400 for a neighbour on another day or under another parent", async () => {
    const t = setup();
    const a = await make(t, "a");
    const otherDay = await make(t, "x", { day: "2026-10-21" });
    const parent = await make(t, "p");
    const sub = await make(t, "s", { parentId: parent.id });
    const before = await titles(t);
    for (const [id, body] of [
      [a.id, { beforeId: otherDay.id }],
      [a.id, { afterId: sub.id }],
      [sub.id, { beforeId: a.id }],
    ] as const) {
      const res = await t.call("PATCH", `/v1/todos/${id}/position`, body);
      expect(res.status).toBe(400);
      expect((await t.json(res)).error.code).toBe("validation_error");
    }
    expect(await titles(t)).toEqual(before);
  });

  it("is 400 for a deleted neighbour and 404 for an unknown or deleted To-do", async () => {
    const t = setup();
    const a = await make(t, "a");
    const b = await make(t, "b");
    await t.call("DELETE", `/v1/todos/${b.id}`);
    expect(
      (await t.call("PATCH", `/v1/todos/${a.id}/position`, { afterId: b.id }))
        .status,
    ).toBe(400);
    expect((await t.call("PATCH", `/v1/todos/nope/position`, {})).status).toBe(
      404,
    );
    expect(
      (await t.call("PATCH", `/v1/todos/${b.id}/position`, {})).status,
    ).toBe(404);
  });

  it("is 400 for a body that is not an object of strings", async () => {
    const t = setup();
    const a = await make(t, "a");
    const res = await t.call("PATCH", `/v1/todos/${a.id}/position`, {
      beforeId: 5,
    });
    expect(res.status).toBe(400);
    expect((await t.json(res)).error.details.fields).toHaveProperty("beforeId");
  });

  it("is 409 conflict for a stale expectedUpdatedAt or If-Match, and moves when fresh", async () => {
    const t = setup();
    const a = await make(t, "a");
    const b = await make(t, "b");
    const stale = "1999-01-01T00:00:00.000Z";
    for (const [body, headers] of [
      [{ beforeId: a.id, expectedUpdatedAt: stale }, {}],
      [{ beforeId: a.id }, { "If-Match": `"${stale}"` }],
    ] as const) {
      const res = await t.call(
        "PATCH",
        `/v1/todos/${b.id}/position`,
        body,
        headers,
      );
      expect(res.status).toBe(409);
      expect((await t.json(res)).error.details.currentUpdatedAt).toBe(
        b.updatedAt,
      );
    }
    expect(await titles(t)).toEqual(["a", "b"]);
    const ok = await t.call(
      "PATCH",
      `/v1/todos/${b.id}/position`,
      { beforeId: a.id },
      { "If-Match": `"${b.updatedAt}"` },
    );
    expect(ok.status).toBe(200);
    expect(await titles(t)).toEqual(["b", "a"]);
  });
});

describe("Reminders", () => {
  // Fixed clock: Saturday 12:00 in Rome.
  const freeze = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T10:00:00.000Z"));
  };
  afterEach(() => vi.useRealTimers());

  it("POST turns remindAt into day and time, and returns the reminder", async () => {
    freeze();
    const { call, json } = setup();
    const res = await call("POST", "/v1/todos", {
      title: "Call the bank",
      remindAt: "2026-10-18T15:00:00+02:00",
    });
    expect(res.status).toBe(201);
    const todo = await json(res);
    expect(todoSchema.parse(todo)).toEqual(todo);
    expect(todo).toMatchObject({
      day: "2026-10-18",
      reminder: {
        time: "15:00",
        status: "pending",
        failure: null,
        sentAt: null,
      },
    });
  });

  it("POST takes time on a day, or on today", async () => {
    freeze();
    const { call, json } = setup();
    const withDay = await json(
      await call("POST", "/v1/todos", {
        title: "a",
        day: "2026-10-20",
        time: "09:00",
      }),
    );
    expect(withDay.reminder.time).toBe("09:00");
    const today = await json(
      await call("POST", "/v1/todos", { title: "b", time: "18:00" }),
    );
    expect(today).toMatchObject({
      day: "2026-10-17",
      reminder: { time: "18:00" },
    });
  });

  it.each([
    [
      "time together with remindAt",
      { time: "15:00", remindAt: "2026-10-18T15:00:00+02:00" },
      "remindAt",
    ],
    [
      "a remindAt without an offset",
      { remindAt: "2026-10-18T15:00:00" },
      "remindAt",
    ],
    ["a malformed time", { day: "2026-10-20", time: "9am" }, "time"],
    ["a time with day null", { day: null, time: "09:00" }, "time"],
    ["a past time today", { time: "09:00" }, "time"],
    ["a past remindAt", { remindAt: "2026-10-17T11:00:00+02:00" }, "remindAt"],
    [
      "a day that disagrees with remindAt",
      { day: "2026-10-19", remindAt: "2026-10-18T15:00:00+02:00" },
      "day",
    ],
  ])("POST refuses %s with validation_error", async (_, body, field) => {
    freeze();
    const { call, json } = setup();
    const res = await call("POST", "/v1/todos", { title: "x", ...body });
    expect(res.status).toBe(400);
    const { error } = await json(res);
    expect(error.code).toBe("validation_error");
    expect(error.details.fields).toHaveProperty(field);
    const list = await json(await call("GET", "/v1/todos?state=open"));
    expect(list.items).toEqual([]);
  });

  it("PATCH sets, moves and removes the Reminder", async () => {
    freeze();
    const { call, json } = setup();
    const todo = await json(
      await call("POST", "/v1/todos", {
        title: "Pay rent",
        day: "2026-10-20",
        time: "09:00",
      }),
    );
    const moved = await json(
      await call("PATCH", `/v1/todos/${todo.id}`, { day: "2026-10-22" }),
    );
    expect(moved).toMatchObject({
      day: "2026-10-22",
      reminder: { time: "09:00", status: "pending" },
    });
    const retimed = await json(
      await call("PATCH", `/v1/todos/${todo.id}`, { time: "10:30" }),
    );
    expect(retimed.reminder.time).toBe("10:30");
    const removed = await json(
      await call("PATCH", `/v1/todos/${todo.id}`, { time: null }),
    );
    expect(removed).toMatchObject({ day: "2026-10-22", reminder: null });
    const again = await json(
      await call("PATCH", `/v1/todos/${todo.id}`, { time: "08:00" }),
    );
    expect(again.reminder).toMatchObject({ time: "08:00", status: "pending" });
    const anytime = await json(
      await call("PATCH", `/v1/todos/${todo.id}`, { day: null }),
    );
    expect(anytime).toMatchObject({ day: null, reminder: null });
  });

  it.each([
    ["a past time", { time: "09:00", day: "2026-10-17" }, "time"],
    ["day: null together with time", { day: null, time: "09:00" }, "time"],
    ["a malformed time", { time: "24:00" }, "time"],
  ])("PATCH refuses %s with validation_error", async (_, body, field) => {
    freeze();
    const { call, json } = setup();
    const todo = await json(
      await call("POST", "/v1/todos", { title: "x", day: "2026-10-20" }),
    );
    const res = await call("PATCH", `/v1/todos/${todo.id}`, body);
    expect(res.status).toBe(400);
    const { error } = await json(res);
    expect(error.code).toBe("validation_error");
    expect(error.details.fields).toHaveProperty(field);
  });

  it("PATCH refuses to move a To-do with a Reminder to a day where it has passed", async () => {
    freeze();
    const { call, json } = setup();
    const todo = await json(
      await call("POST", "/v1/todos", {
        title: "x",
        day: "2026-10-20",
        time: "09:00",
      }),
    );
    const res = await call("PATCH", `/v1/todos/${todo.id}`, {
      day: "2026-10-17",
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error.details.fields).toHaveProperty("day");
    const same = await json(await call("GET", `/v1/todos/${todo.id}`));
    expect(same).toMatchObject({
      day: "2026-10-20",
      reminder: { time: "09:00" },
    });
  });
});

describe("auth", () => {
  it("requires a token on every To-do route", async () => {
    const { app } = setup();
    for (const [method, path] of [
      ["GET", "/v1/todos?state=open"],
      ["POST", "/v1/todos"],
      ["GET", "/v1/todos/x"],
      ["PATCH", "/v1/todos/x"],
      ["PATCH", "/v1/todos/x/position"],
      ["DELETE", "/v1/todos/x"],
    ] as const) {
      expect(
        (await app.request(path, { method })).status,
        `${method} ${path}`,
      ).toBe(401);
    }
  });
});
