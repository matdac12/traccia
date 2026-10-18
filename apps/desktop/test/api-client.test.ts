import { describe, expect, it, vi } from "vitest";
import {
  type ApiOutcome,
  createApiClient,
  REFUSED_MESSAGE,
  type Transport,
} from "../src/api-client";

const todo = {
  id: "td_1",
  title: "Call @ACME about the invoice",
  references: [{ key: "ACME", projectId: "pr_1", projectDeleted: false }],
  day: "2026-10-18",
  reminder: { time: "15:00", status: "pending", failure: null, sentAt: null },
  state: "open",
  closedAt: null,
  parentId: null,
  subTodos: null,
  position: 1,
  details: null,
  source: "desktop",
  url: "https://box.tail.ts.net/personal?todo=td_1",
  createdAt: "2026-10-17T10:00:00.000Z",
  updatedAt: "2026-10-17T10:00:00.000Z",
};

const json = (status: number, body: unknown): ApiOutcome => ({
  kind: "response",
  status,
  body: JSON.stringify(body),
});

/** A transport that answers each call with the next outcome and records the calls. */
function transport(...outcomes: ApiOutcome[]) {
  const send = vi.fn<Transport>(async () => {
    const next = outcomes.shift();
    if (!next) throw new Error("no more outcomes");
    return next;
  });
  return send;
}

describe("the API client", () => {
  it("lists a page of open To-dos, parsed with the shared schema", async () => {
    const send = transport(json(200, { items: [todo], nextCursor: null }));

    const result = await createApiClient(send).listTodos({
      state: "open",
      limit: 1,
    });

    expect(send).toHaveBeenCalledWith(
      "GET",
      "/v1/todos?state=open&limit=1",
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      value: { items: [todo], nextCursor: null },
    });
  });

  it("pages through every open To-do", async () => {
    const second = { ...todo, id: "td_2" };
    const send = transport(
      json(200, { items: [todo], nextCursor: "c1" }),
      json(200, { items: [second], nextCursor: null }),
    );

    const result = await createApiClient(send).listOpenTodos();

    expect(send.mock.calls.map((call) => call[1])).toEqual([
      "/v1/todos?state=open&limit=250",
      "/v1/todos?state=open&limit=250&cursor=c1",
    ]);
    expect(result).toEqual({ ok: true, value: [todo, second] });
  });

  it("lists today's done To-dos from the Logbook, paging back to the first closed before today in Rome", async () => {
    const closed = (id: string, state: string, closedAt: string) => ({
      ...todo,
      id,
      state,
      closedAt,
    });
    const send = transport(
      json(200, {
        items: [
          closed("late", "done", "2026-10-19T21:30:00.000Z"),
          closed("drop", "dropped", "2026-10-19T09:00:00.000Z"),
        ],
        nextCursor: "c1",
      }),
      json(200, {
        items: [
          // 00:30 on the 19th in Rome: still today.
          closed("early", "done", "2026-10-18T22:30:00.000Z"),
          closed("yesterday", "done", "2026-10-18T21:30:00.000Z"),
          closed("older", "done", "2026-10-17T08:00:00.000Z"),
        ],
        nextCursor: "c2",
      }),
    );

    const result = await createApiClient(send).listDoneToday(
      "Europe/Rome",
      "2026-10-19",
    );

    expect(send.mock.calls.map((call) => call[1])).toEqual([
      "/v1/todos?state=closed&limit=250",
      "/v1/todos?state=closed&limit=250&cursor=c1",
    ]);
    expect(result.ok && result.value.map((t) => t.id)).toEqual([
      "late",
      "early",
    ]);
  });

  it("keeps a parent's Sub-to-do count, and null for a To-do without one", async () => {
    const parent = { ...todo, id: "td_p", subTodos: { done: 1, total: 3 } };
    const send = transport(
      json(200, { items: [parent, todo], nextCursor: null }),
    );

    const result = await createApiClient(send).listOpenTodos();

    expect(result.ok && result.value.map((t) => t.subTodos)).toEqual([
      { done: 1, total: 3 },
      null,
    ]);
  });

  it("pages through every live Project, keeping what the window uses", async () => {
    const project = (id: string, key: string) => ({
      id,
      key,
      name: `${key} project`,
      status: "active",
      issueCounts: { open: 2 },
    });
    const send = transport(
      json(200, { items: [project("pr_1", "TRC")], nextCursor: "c1" }),
      json(200, { items: [project("pr_2", "CRM")], nextCursor: null }),
    );

    const result = await createApiClient(send).listProjects();

    expect(send.mock.calls.map((call) => call[1])).toEqual([
      "/v1/projects?limit=250",
      "/v1/projects?limit=250&cursor=c1",
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        { id: "pr_1", key: "TRC", name: "TRC project", status: "active" },
        { id: "pr_2", key: "CRM", name: "CRM project", status: "active" },
      ],
    });
  });

  it("creates and updates To-dos with a JSON body", async () => {
    const send = transport(
      json(201, todo),
      json(200, { ...todo, state: "done" }),
    );
    const client = createApiClient(send);

    const created = await client.createTodo({
      title: "Call @ACME",
      time: "15:00",
    });
    const updated = await client.updateTodo("td_1", { state: "done" });

    expect(send.mock.calls).toEqual([
      ["POST", "/v1/todos", { title: "Call @ACME", time: "15:00" }],
      ["PATCH", "/v1/todos/td_1", { state: "done" }],
    ]);
    expect(created).toEqual({ ok: true, value: todo });
    expect(updated.ok && updated.value.state).toBe("done");
  });

  it.each([401, 403])(
    "turns a %i into the refused-Token message",
    async (status) => {
      const send = transport(
        json(status, {
          error: { code: "unauthorized", message: "Invalid token" },
        }),
      );

      const result = await createApiClient(send).listOpenTodos();

      expect(result).toEqual({
        ok: false,
        failure: {
          kind: "refused",
          status,
          message: REFUSED_MESSAGE,
          apiMessage: "Invalid token",
        },
      });
      expect(REFUSED_MESSAGE).toBe("Traccia refused the Token. Open Settings.");
    },
  );

  it("passes other API errors on with their code, message and details", async () => {
    const send = transport(
      json(409, {
        error: {
          code: "conflict",
          message: "It has 2 open Sub-to-dos",
          details: { openSubTodos: 2 },
        },
      }),
    );

    const result = await createApiClient(send).updateTodo("td_1", {
      state: "done",
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: "error",
        status: 409,
        code: "conflict",
        message: "It has 2 open Sub-to-dos",
        details: { openSubTodos: 2 },
      },
    });
  });

  it("describes an error with no JSON body by its status", async () => {
    const send = transport({
      kind: "response",
      status: 502,
      body: "Bad Gateway",
    });

    const result = await createApiClient(send).listOpenTodos();

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: "error",
        status: 502,
        message: "Traccia answered 502.",
      },
    });
  });

  it("reports offline as its own failure", async () => {
    const send = transport({ kind: "offline", reason: "timed out" });

    const result = await createApiClient(send).listOpenTodos();

    expect(result).toEqual({
      ok: false,
      failure: { kind: "offline", reason: "timed out" },
    });
  });

  it("asks for Settings when there is no API URL or Token yet", async () => {
    const send = transport({ kind: "notConfigured" });

    const result = await createApiClient(send).listOpenTodos();

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: "notConfigured",
        message: "Open Settings to connect to Traccia.",
      },
    });
  });

  it("refuses a response that doesn't match the To-do schema", async () => {
    const send = transport(
      json(200, { items: [{ ...todo, state: "archived" }], nextCursor: null }),
    );

    const result = await createApiClient(send).listOpenTodos();

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.kind).toBe("invalid");
  });

  it("refuses a success that isn't JSON", async () => {
    const send = transport({ kind: "response", status: 200, body: "<html>" });

    const result = await createApiClient(send).createTodo({ title: "x" });

    expect(!result.ok && result.failure).toEqual({
      kind: "invalid",
      message: "Traccia sent a response the Desktop app can't read.",
    });
  });

  it("reports a refused command (a Rust-side error) as invalid", async () => {
    const send = vi.fn<Transport>(async () => {
      throw "not an API path: /files";
    });

    const result = await createApiClient(send).listOpenTodos();

    expect(!result.ok && result.failure).toEqual({
      kind: "invalid",
      message: "not an API path: /files",
    });
  });
});
