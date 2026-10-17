import { todoSchema } from "@traccia/shared";
import { describe, expect, it } from "vitest";
import { createToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

function setup() {
  const t = createTestApp({ BASE_URL: "https://traccia.example.ts.net/" });
  const parla = createToken(t.db, { name: "parla", actor: "you" });
  const call = (method: string, path: string, body?: unknown) =>
    t.app.request(path, {
      method,
      headers: {
        Authorization: `Bearer ${parla.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  const json = async (res: Response) => (await res.json()) as any;
  return { ...t, call, json, token: parla.token };
}

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

describe("auth", () => {
  it("requires a token on every To-do route", async () => {
    const { app } = setup();
    for (const [method, path] of [
      ["GET", "/v1/todos?state=open"],
      ["POST", "/v1/todos"],
      ["GET", "/v1/todos/x"],
    ] as const) {
      expect(
        (await app.request(path, { method })).status,
        `${method} ${path}`,
      ).toBe(401);
    }
  });
});
