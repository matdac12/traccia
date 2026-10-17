import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("../lib/api/client", () => ({ api: () => ({ request }) }));
vi.mock("../lib/server-env", () => ({ serverEnv: () => ({ ownerTimezone: "Europe/Rome" }) }));
const { listOpenTodos, listTodosClosedOn, loadPersonalSpace } = await import("../lib/api/todos");

const item = (id: string, closedAt: string | null = null) => ({ id, closedAt });

beforeEach(() => request.mockReset());

describe("listOpenTodos", () => {
  it("follows nextCursor until the last page", async () => {
    request
      .mockResolvedValueOnce({ items: [item("a"), item("b")], nextCursor: "c1" })
      .mockResolvedValueOnce({ items: [item("c")], nextCursor: null });
    const out = await listOpenTodos();
    expect(out.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toBe("/todos");
    expect(request.mock.calls[0][1].query).toEqual({ state: "open", limit: 250, cursor: undefined });
    expect(request.mock.calls[1][1].query).toMatchObject({ state: "open", cursor: "c1" });
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
  });

  it("stops after one request when nothing was closed that day", async () => {
    request.mockResolvedValueOnce({ items: [item("w", "2026-10-15T10:00:00Z")], nextCursor: "c1" });
    expect(await listTodosClosedOn("2026-10-17", "Europe/Rome")).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("loadPersonalSpace", () => {
  it("dates today in the Owner timezone and returns the open To-dos plus those closed today, with Sub-to-do counts", async () => {
    request
      .mockResolvedValueOnce({ items: [{ id: "p", parentId: null, state: "open" }], nextCursor: null })
      .mockResolvedValueOnce({ items: [{ id: "k", parentId: "p", state: "done", closedAt: "2026-10-17T22:30:00Z" }], nextCursor: null });
    // 22:45Z on the 17th is already the 18th in Rome.
    const out = await loadPersonalSpace(new Date("2026-10-17T22:45:00Z"));
    expect(out.today).toBe("2026-10-18");
    expect(request.mock.calls.map((c) => c[1].query.state)).toEqual(["open", "closed"]);
    expect(out.todos.map((t) => [t.id, t.subTodos])).toEqual([["p", { done: 1, total: 1 }], ["k", null]]);
  });
});
