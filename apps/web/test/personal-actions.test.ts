import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const fetchMock = vi.fn();
vi.mock("../lib/api/client", async (orig) => {
  const mod = await orig<typeof import("../lib/api/client")>();
  const client = mod.createApiClient({ baseUrl: "http://api", token: "t", fetch: ((...a: unknown[]) => fetchMock(...a)) as never });
  return { ...mod, api: () => client };
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const apiError = (status: number, code: string, message: string, details: object = {}) => json({ error: { code, message, details } }, status);

const todo = {
  id: "01TODO",
  title: "Plan the trip",
  references: [],
  day: "2026-10-17",
  reminder: null,
  state: "done",
  closedAt: "2026-10-17T13:00:00Z",
  parentId: null,
  subTodos: { done: 2, total: 2 },
  position: 1024,
  details: null,
  source: "dashboard",
  url: "http://x/personal?todo=01TODO",
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-17T13:00:00.000Z",
};
const SEEN = "2026-10-17T12:00:00.000Z";
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), method: (init as RequestInit).method, body: JSON.parse(((init as RequestInit).body as string) ?? "null") }));

const { updateTodoAction, deleteTodoAction, moveTodoAction } = await import("../app/(app)/personal/actions");

beforeEach(() => {
  fetchMock.mockReset();
  revalidatePath.mockReset();
});

describe("updateTodoAction", () => {
  it("patches the To-do, returns it and re-renders /personal", async () => {
    fetchMock.mockResolvedValueOnce(json(todo));
    const res = await updateTodoAction("01TODO", { state: "done", closeSubTodos: true }, SEEN);
    expect(res).toEqual({ ok: true, data: { todo } });
    expect(calls()).toEqual([{ url: "http://api/v1/todos/01TODO", method: "PATCH", body: { state: "done", closeSubTodos: true, expectedUpdatedAt: SEEN } }]);
    expect(revalidatePath).toHaveBeenCalledWith("/personal");
  });

  it("passes the API's open Sub-to-do count on when a parent can't close alone", async () => {
    fetchMock.mockResolvedValueOnce(apiError(409, "conflict", "The To-do has 2 open Sub-to-dos", { openSubTodos: 2 }));
    const res = await updateTodoAction("01TODO", { state: "done" }, SEEN);
    expect(res).toMatchObject({ ok: false, openSubTodos: 2 });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns the API's field errors, e.g. a Reminder moment already past", async () => {
    fetchMock.mockResolvedValueOnce(apiError(400, "validation_error", "Invalid request", { fields: { time: ["must be in the future"] } }));
    expect(await updateTodoAction("01TODO", { time: "09:00" }, SEEN)).toMatchObject({ ok: false, fieldErrors: { time: "must be in the future" } });
  });

  it("refuses a bad id or patch before calling the API", async () => {
    expect(await updateTodoAction("../issues", { state: "done" }, SEEN)).toMatchObject({ ok: false });
    expect(await updateTodoAction("01TODO", { day: null, time: "09:00" }, SEEN)).toMatchObject({ ok: false, fieldErrors: { time: expect.any(String) } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the updatedAt the page saw, and re-renders /personal when the To-do changed since", async () => {
    fetchMock.mockResolvedValueOnce(apiError(409, "conflict", "The To-do changed since you read it", { currentUpdatedAt: "2026-10-17T14:00:00.000Z" }));
    const res = await updateTodoAction("01TODO", { day: "2026-10-18", junk: 1 } as never, SEEN);
    expect(calls()[0]?.body).toEqual({ day: "2026-10-18", expectedUpdatedAt: SEEN });
    expect(res).toMatchObject({ ok: false, conflict: true, error: "The To-do changed since you read it" });
    expect(revalidatePath).toHaveBeenCalledWith("/personal");
  });
});

describe("deleteTodoAction", () => {
  it("moves the To-do to the Trash and re-renders /personal", async () => {
    fetchMock.mockResolvedValueOnce(json({ type: "todo", id: "01TODO", batch: "b1", counts: { todos: 3 }, title: "Plan the trip", purged: false }));
    expect(await deleteTodoAction("01TODO")).toEqual({ ok: true, data: undefined });
    expect(calls()).toEqual([{ url: "http://api/v1/todos/01TODO", method: "DELETE", body: null }]);
    expect(revalidatePath).toHaveBeenCalledWith("/personal");
  });

  it("reports a refusal", async () => {
    fetchMock.mockResolvedValueOnce(apiError(404, "not_found", "To-do not found"));
    expect(await deleteTodoAction("01TODO")).toMatchObject({ ok: false, error: "To-do not found" });
  });
});

describe("moveTodoAction", () => {
  it("moves the To-do within its bucket, returns it and re-renders /personal", async () => {
    fetchMock.mockResolvedValueOnce(json(todo));
    expect(await moveTodoAction("01TODO", { afterId: "01PREV" })).toEqual({ ok: true, data: { todo } });
    expect(calls()).toEqual([{ url: "http://api/v1/todos/01TODO/position", method: "PATCH", body: { afterId: "01PREV" } }]);
    expect(revalidatePath).toHaveBeenCalledWith("/personal");
  });

  it("reports the API's refusal of a neighbour from another bucket", async () => {
    fetchMock.mockResolvedValueOnce(apiError(400, "validation_error", "Invalid request", { fields: { beforeId: ["must be in the same bucket"] } }));
    expect(await moveTodoAction("01TODO", { beforeId: "01ELSE" })).toMatchObject({ ok: false, fieldErrors: { beforeId: "must be in the same bucket" } });
  });

  it("refuses a bad id before calling the API", async () => {
    expect(await moveTodoAction("../x", { afterId: "01PREV" })).toMatchObject({ ok: false });
    expect(await moveTodoAction("01TODO", { afterId: "../x" })).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
