import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { tokens } from "../src/db/schema.js";
import { createServices } from "../src/service/index.js";
import { createToken, type TokenScope } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

type ErrorBody = { error: { code: string; message: string } };

function setup(env: Record<string, string> = {}) {
  const t = createTestApp(env);
  const services = createServices({ db: t.db, defaultIssueKey: "MAT" });
  const project = services.projects.create("you", { name: "CRM", key: "CRM" });
  const issue = services.issues.create("you", {
    project: "CRM",
    title: "An issue",
  });

  const caller =
    (token: string) => (method: string, path: string, body?: unknown) =>
      t.app.request(path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
  const make = (actor: "agent" | "you", scope: TokenScope) =>
    caller(
      createToken(t.db, { name: `${actor}-${scope}`, actor, scope }).token,
    );

  return {
    ...t,
    project,
    issue,
    todos: make("you", "todos"),
    agentTodos: make("agent", "todos"),
    all: make("you", "all"),
    agentAll: make("agent", "all"),
  };
}

async function expectForbidden(res: Response, message?: RegExp) {
  expect(res.status).toBe(403);
  const body = (await res.json()) as ErrorBody;
  expect(body.error.code).toBe("forbidden");
  expect(body.error.message).toMatch(message ?? /todos/);
}

describe("a todos token: allowed", () => {
  it("creates, lists, reads, edits and soft-deletes To-dos", async () => {
    const { todos } = setup();
    const created = await todos("POST", "/v1/todos", { title: "Gym" });
    expect(created.status).toBe(201);
    const { id, updatedAt } = (await created.json()) as {
      id: string;
      updatedAt: string;
    };

    expect((await todos("GET", "/v1/todos?state=open")).status).toBe(200);
    expect((await todos("GET", `/v1/todos/${id}`)).status).toBe(200);
    expect(
      (
        await todos("PATCH", `/v1/todos/${id}`, {
          title: "Gym 2",
          expectedUpdatedAt: updatedAt,
        })
      ).status,
    ).toBe(200);
    expect((await todos("DELETE", `/v1/todos/${id}`)).status).toBe(200);
    expect(
      (await todos("DELETE", `/v1/todos/${id}?purge=false`)).status,
    ).not.toBe(403);
  });

  it("restores a To-do through POST /v1/restore", async () => {
    const { todos } = setup();
    const { id } = (await (
      await todos("POST", "/v1/todos", { title: "Gym" })
    ).json()) as { id: string };
    await todos("DELETE", `/v1/todos/${id}`);
    const res = await todos("POST", "/v1/restore", { type: "todo", id });
    expect(res.status).toBe(200);
  });

  it("reads Projects, by list and by key", async () => {
    const { todos, project } = setup();
    expect((await todos("GET", "/v1/projects")).status).toBe(200);
    expect((await todos("GET", `/v1/projects/${project.id}`)).status).toBe(200);
    expect((await todos("HEAD", "/v1/projects")).status).toBe(200);
  });

  it("calls GET /v1/me", async () => {
    const { todos } = setup();
    const res = await todos("GET", "/v1/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      actor: "you",
      tokenName: "you-todos",
    });
  });

  it("is covered under /v1/todos by prefix, so later routes need no change", async () => {
    const { todos } = setup();
    // Not a route yet (TRC-158 adds /v1/todos/delivery): it must reach
    // routing and come back as a To-do lookup, never as a scope 403.
    const res = await todos("GET", "/v1/todos/delivery");
    expect(res.status).not.toBe(403);
  });
});

describe("a todos token: denied", () => {
  it.each<[string, string, unknown?]>([
    ["POST", "/v1/projects", { name: "Nope", key: "NOP" }],
    ["PATCH", "/v1/projects/CRM", { name: "Renamed" }],
    ["DELETE", "/v1/projects/CRM"],
    ["GET", "/v1/projects/CRM/documents"],
    ["GET", "/v1/projects/CRM/memories"],
    ["GET", "/v1/projects/CRM/milestones"],
    ["GET", "/v1/projects/CRM/anything/else"],
    ["GET", "/v1/issues"],
    ["POST", "/v1/issues", { project: "CRM", title: "x" }],
    ["GET", "/v1/memories/x"],
    ["GET", "/v1/milestones/x"],
    ["GET", "/v1/labels"],
    ["GET", "/v1/search?q=x"],
    ["GET", "/v1/activity"],
    ["GET", "/v1/trash"],
    ["GET", "/v1/documents/x"],
    ["GET", "/v1/attachments/x"],
    ["GET", "/v1/files/x"],
    ["GET", "/files/x"],
    ["GET", "/files/doc/x"],
    ["POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }],
    ["GET", "/v1/todosfoo"],
    ["GET", "/v1/todos/../issues"],
    ["GET", "/v1/%69ssues"],
    ["GET", "/v1/unknown"],
  ])("%s %s is 403 forbidden", async (method, path, body) => {
    const { todos } = setup();
    await expectForbidden(await todos(method, path, body));
  });

  it("cannot restore anything but a To-do", async () => {
    const { todos, all, issue } = setup();
    await all("DELETE", `/v1/issues/${issue.identifier}`);
    await expectForbidden(
      await todos("POST", "/v1/restore", {
        type: "issue",
        id: issue.identifier,
      }),
      /todo/,
    );
    // Still deleted: the 403 came before anything ran.
    expect((await all("GET", `/v1/issues/${issue.identifier}`)).status).toBe(
      404,
    );
  });

  it("cannot purge a To-do, and the To-do survives the attempt", async () => {
    const { todos, all } = setup();
    const { id } = (await (
      await todos("POST", "/v1/todos", { title: "Gym" })
    ).json()) as { id: string };
    await todos("DELETE", `/v1/todos/${id}`);

    for (const query of ["purge=true", "purge=false&purge=true", "purge=1"]) {
      await expectForbidden(
        await todos("DELETE", `/v1/todos/${id}?${query}`),
        /purge/,
      );
    }
    // The soft-deleted To-do is still there to restore.
    const restored = await all("POST", "/v1/restore", { type: "todo", id });
    expect(restored.status).toBe(200);
  });

  it("is refused before the body is read", async () => {
    const { todos } = setup();
    await expectForbidden(await todos("POST", "/v1/projects", { nonsense: 1 }));
  });
});

describe("an all token is unchanged", () => {
  it("reaches every area, and may purge a deleted To-do", async () => {
    const { all } = setup();
    for (const path of [
      "/v1/me",
      "/v1/issues",
      "/v1/projects",
      "/v1/projects/CRM/memories",
      "/v1/trash",
      "/v1/todos?state=open",
    ]) {
      expect((await all("GET", path)).status, path).toBe(200);
    }
    const { id } = (await (
      await all("POST", "/v1/todos", { title: "Gym" })
    ).json()) as { id: string };
    await all("DELETE", `/v1/todos/${id}`);
    expect((await all("DELETE", `/v1/todos/${id}?purge=true`)).status).toBe(
      200,
    );
  });

  it("reaches /mcp", async () => {
    const { all } = setup();
    const res = await all("POST", "/mcp", {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });
    expect(res.status).not.toBe(403);
  });
});

describe("To-do purge is reserved for you", () => {
  it("refuses an agent token even with ALLOW_AGENT_PURGE=true", async () => {
    const { agentAll } = setup({ ALLOW_AGENT_PURGE: "true" });
    const { id } = (await (
      await agentAll("POST", "/v1/todos", { title: "Gym" })
    ).json()) as { id: string };
    await agentAll("DELETE", `/v1/todos/${id}`);
    const res = await agentAll("DELETE", `/v1/todos/${id}?purge=true`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe("forbidden");
  });

  it("still lets an agent token purge other types when the switch is on", async () => {
    const { agentAll, issue } = setup({ ALLOW_AGENT_PURGE: "true" });
    await agentAll("DELETE", `/v1/issues/${issue.identifier}`);
    expect(
      (await agentAll("DELETE", `/v1/issues/${issue.identifier}?purge=true`))
        .status,
    ).toBe(200);
  });
});

describe("scope on the token row", () => {
  it("an unrecognised scope is rejected as unauthenticated, not widened to all", async () => {
    const { db, all, todos } = setup();
    db.update(tokens)
      .set({ scopes: "billing" })
      .where(eq(tokens.name, "you-all"))
      .run();
    expect((await all("GET", "/v1/me")).status).toBe(401);
    expect((await todos("GET", "/v1/me")).status).toBe(200);
  });
});
