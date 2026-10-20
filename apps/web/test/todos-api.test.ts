import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("../lib/api/client", async (original) => ({ ...(await original<typeof import("../lib/api/client")>()), api: () => ({ request }) }));
vi.mock("../lib/server-env", () => ({ serverEnv: () => ({ ownerTimezone: "Europe/Rome" }) }));
const { listOpenTodos, listTodosClosedOn, loadPersonalSpace } = await import("../lib/api/todos");
const { ApiError: ApiErrorClass } = await import("../lib/api/client");

const item = (id: string, closedAt: string | null = null) => ({ id, closedAt });

beforeEach(() => {
  request.mockReset();
});

describe("listOpenTodos", () => {
  it("follows nextCursor until the last page", async () => {
    request.mockResolvedValueOnce({ items: [item("a"), item("b")], nextCursor: "c1" }).mockResolvedValueOnce({ items: [item("c")], nextCursor: null });
    const out = await listOpenTodos();
    expect(out.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toBe("/todos");
    expect(request.mock.calls[0][1].query).toEqual({ state: "open", limit: 250, cursor: undefined });
    expect(request.mock.calls[1][1].query).toMatchObject({ state: "open", cursor: "c1" });
  });

  it("reads every page conditionally, so an unchanged poll is a 304", async () => {
    request.mockResolvedValueOnce({ items: [item("a")], nextCursor: "c1" }).mockResolvedValueOnce({ items: [item("b")], nextCursor: null });
    await listOpenTodos();
    expect(request.mock.calls.map((c) => c[1].conditional)).toEqual([true, true]);
  });
});

describe("listTodosClosedOn", () => {
  it("reads the Logbook only as far back as the day, in the Owner timezone", async () => {
    // Newest first. 22:30Z on the 16th is already the 17th in Rome; 21:30Z is still the 16th.
    request
      .mockResolvedValueOnce({ items: [item("x", "2026-10-17T18:00:00Z"), item("y", "2026-10-16T22:30:00Z")], nextCursor: "c1" })
      .mockResolvedValueOnce({ items: [item("z", "2026-10-16T21:30:00Z"), item("w", "2026-10-15T10:00:00Z")], nextCursor: "c2" });
    const out = await listTodosClosedOn("2026-10-17", "Europe/Rome");
    expect(out.map((t) => t.id)).toEqual(["x", "y"]);
    // The second page reached an earlier day, so the third is never asked for.
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1].query).toMatchObject({ state: "closed", limit: 50 });
    expect(request.mock.calls.every((c) => c[1].conditional === true)).toBe(true);
  });

  it("stops after one request when nothing was closed that day", async () => {
    request.mockResolvedValueOnce({ items: [item("w", "2026-10-15T10:00:00Z")], nextCursor: "c1" });
    expect(await listTodosClosedOn("2026-10-17", "Europe/Rome")).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("loadPersonalSpace", () => {
  it("dates today in the Owner timezone and returns the open To-dos plus those closed today, with the API's Sub-to-do counts", async () => {
    request
      .mockResolvedValueOnce({ items: [{ id: "p", parentId: null, state: "open", subTodos: { done: 2, total: 3 } }], nextCursor: null })
      .mockResolvedValueOnce({ items: [{ id: "k", parentId: "p", state: "done", closedAt: "2026-10-17T22:30:00Z", subTodos: null }], nextCursor: null });
    // 22:45Z on the 17th is already the 18th in Rome.
    const out = await loadPersonalSpace(new Date("2026-10-17T22:45:00Z"));
    expect(out.today).toBe("2026-10-18");
    expect(request.mock.calls.filter((c) => c[0] === "/todos").map((c) => c[1].query.state)).toEqual(["open", "closed"]);
    expect(out.todos.map((t) => [t.id, t.subTodos])).toEqual([
      ["p", { done: 2, total: 3 }],
      ["k", null],
    ]);
  });
});

describe("loadPersonalSpace across midnight with unchanged lists", () => {
  it("re-dates today and re-sorts the kept Logbook page, since the lists alone say nothing about the day", async () => {
    // The same two answers each time, as the API's 304 gives them back.
    const open = { items: [{ id: "o", state: "open", closedAt: null }], nextCursor: null };
    const closed = { items: [{ id: "k", state: "done", closedAt: "2026-10-17T21:30:00Z" }], nextCursor: null };
    request.mockImplementation(async (path: string, options: { query?: { state?: string } }) => (path !== "/todos" ? { ok: true } : options.query?.state === "open" ? open : closed));
    // 21:30Z on the 17th is 23:30 in Rome: closed today. An hour later it is the 18th and k is yesterday's.
    const before = await loadPersonalSpace(new Date("2026-10-17T21:45:00Z"));
    const after = await loadPersonalSpace(new Date("2026-10-17T22:15:00Z"));
    expect([before.today, before.todos.map((t) => t.id)]).toEqual(["2026-10-17", ["o", "k"]]);
    expect([after.today, after.todos.map((t) => t.id)]).toEqual(["2026-10-18", ["o"]]);
  });
});

describe("loadPersonalSpace delivery state", () => {
  const serve = (delivery: () => unknown) => request.mockImplementation(async (path: string) => (path === "/todos/delivery" ? delivery() : { items: [], nextCursor: null }));

  it("carries the API's delivery state for the banner", async () => {
    serve(() => ({ ok: false, reason: "not_configured" }));
    expect((await loadPersonalSpace(new Date("2026-10-17T13:00:00Z"))).delivery).toEqual({ ok: false, reason: "not_configured" });
  });

  it("loads the page without it when the API can't say", async () => {
    serve(() => Promise.reject(new ApiErrorClass(404, "not_found", "Not found")));
    const out = await loadPersonalSpace(new Date("2026-10-17T13:00:00Z"));
    expect(out).not.toHaveProperty("delivery");
    expect(out.todos).toEqual([]);
  });
});

describe("loadPersonalSpace with a selected To-do (?todo=)", () => {
  const todo = (id: string, over: Record<string, unknown> = {}) => ({ id, parentId: null, state: "open", closedAt: null, ...over });
  /** The API by path, so the order of parallel requests doesn't matter. */
  function serve(routes: Record<string, unknown>, lists: { open?: unknown[]; closed?: unknown[] } = {}) {
    request.mockImplementation(async (path: string, options: { query?: { state?: string } }) => {
      if (path === "/todos") return { items: (options.query?.state === "open" ? lists.open : lists.closed) ?? [], nextCursor: null };
      if (!(path in routes)) throw new ApiErrorClass(404, "not_found", "Not found");
      return routes[path];
    });
  }
  const NOW = new Date("2026-10-17T13:00:00Z");

  it("adds what the lists don't load: the To-do closed on an earlier day and its Sub-to-dos closed earlier", async () => {
    const parent = todo("p", { state: "done", closedAt: "2026-10-10T08:00:00Z" });
    const open = todo("s1", { parentId: "p" });
    const old = todo("s2", { parentId: "p", state: "done", closedAt: "2026-10-10T08:00:00Z" });
    serve({ "/todos/p": parent, "/todos/p/sub-todos": { items: [open, old] } }, { open: [open] });
    const out = await loadPersonalSpace(NOW, "p");
    expect(out.todos.map((t) => t.id)).toEqual(["s1"]);
    expect(out.selected).toEqual({ id: "p", extra: [parent, old] });
  });

  it("adds a Sub-to-do's parent when the lists don't load it", async () => {
    const parent = todo("p", { state: "done", closedAt: "2026-10-10T08:00:00Z" });
    const sub = todo("s", { parentId: "p" });
    serve({ "/todos/s": sub, "/todos/s/sub-todos": { items: [] }, "/todos/p": parent }, { open: [sub] });
    expect((await loadPersonalSpace(NOW, "s")).selected).toEqual({ id: "s", extra: [parent] });
  });

  it("says an unknown, deleted or malformed id no longer exists", async () => {
    serve({ "/todos/gone": todo("gone", { deleted: true }), "/todos/gone/sub-todos": { items: [] } });
    expect((await loadPersonalSpace(NOW, "nope")).selected).toEqual({ id: "nope", extra: [] });
    expect((await loadPersonalSpace(NOW, "gone")).selected).toEqual({ id: "gone", extra: [] });
    request.mockClear();
    expect((await loadPersonalSpace(NOW, "../etc")).selected).toEqual({ id: "../etc", extra: [] });
    expect(request.mock.calls.map((c) => c[0])).toEqual(["/todos", "/todos", "/todos/delivery"]);
  });

  it("fails the load when the API fails another way", async () => {
    request.mockImplementation(async (path: string) => {
      if (path === "/todos") return { items: [], nextCursor: null };
      throw new ApiErrorClass(0, "unreachable", "Could not reach the API");
    });
    await expect(loadPersonalSpace(NOW, "p")).rejects.toThrow("Could not reach the API");
  });
});
