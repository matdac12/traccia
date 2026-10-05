import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../lib/api/client";
import { DEFAULT_FILTERS } from "../lib/issue-filters";

const fetchMock = vi.fn();
vi.mock("../lib/api/client", async (orig) => {
  const mod = await orig<typeof import("../lib/api/client")>();
  const client = mod.createApiClient({ baseUrl: "http://api", token: "t", fetch: ((...a: unknown[]) => fetchMock(...a)) as never });
  return { ...mod, api: () => client };
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const row = (n: number, status = "todo") => ({
  id: `i${n}`, projectId: "p1", key: "TRK", number: n, identifier: `TRK-${n}`, title: `T${n}`, description: "", status, priority: 0, estimate: null,
  assignee: null, milestoneId: null, parentId: null, createdBy: "you", createdAt: "a", updatedAt: `2026-01-01T00:00:0${n}.000Z`, labels: [],
});
const calledUrls = () => fetchMock.mock.calls.map(([u]) => new URL(String(u)));

beforeEach(() => { fetchMock.mockReset(); void createApiClient; });

describe("latestIssueChange", () => {
  it("asks for one row changed after `since`, deleted ones included", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [row(3)], nextCursor: null }));
    const { latestIssueChange } = await import("../lib/api/issues");
    expect(await latestIssueChange("2026-01-01T00:00:00.000Z")).toBe("2026-01-01T00:00:03.000Z");
    const url = calledUrls()[0]!;
    expect(Object.fromEntries(url.searchParams)).toEqual({ updatedAfter: "2026-01-01T00:00:00.000Z", includeDeleted: "true", orderBy: "updatedAt", order: "desc", limit: "1" });
  });

  it("is null when nothing changed", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [], nextCursor: null }));
    const { latestIssueChange } = await import("../lib/api/issues");
    expect(await latestIssueChange()).toBeNull();
  });
});

const group = (status: string, items: unknown[], nextCursor: string | null = null) => ({ status, items, nextCursor });
const groupsBody = (todo: ReturnType<typeof group>) => ({
  groups: ["backlog", "todo", "in_progress", "in_review", "done", "canceled"].map((s) => (s === "todo" ? todo : group(s, []))),
  syncToken: "2026-01-01T00:00:00.000Z",
});

describe("refreshIssueGroups", () => {
  it("is a single request when no group had more pages open", async () => {
    fetchMock.mockImplementation(async () => json(groupsBody(group("todo", [row(1)], "c1"))));
    const { refreshIssueGroups } = await import("../lib/api/issues");
    const groups = await refreshIssueGroups(DEFAULT_FILTERS, { todo: 1 }, false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calledUrls()[0]!.pathname).toBe("/v1/issues/groups");
    expect(groups.find((g) => g.status === "todo")).toMatchObject({ items: [{ id: "i1" }], nextCursor: "c1" });
  });

  it("re-reads as many pages as were loaded, only for the groups that need it", async () => {
    fetchMock.mockImplementation(async (u: URL) => {
      const q = new URL(String(u)).searchParams;
      return q.get("cursor") ? json({ groups: [group("todo", [row(2)], "c2")], syncToken: "x" }) : json(groupsBody(group("todo", [row(1)], "c1")));
    });
    const { refreshIssueGroups } = await import("../lib/api/issues");
    const groups = await refreshIssueGroups(DEFAULT_FILTERS, { todo: 2 }, false);
    expect(groups.find((g) => g.status === "todo")).toMatchObject({ items: [{ id: "i1" }, { id: "i2" }], nextCursor: "c2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const follow = calledUrls()[1]!.searchParams;
    expect(follow.getAll("status")).toEqual(["todo"]);
    expect(follow.getAll("cursor")).toEqual(["todo:c1"]);
  });

  it("lists by board position for the board", async () => {
    fetchMock.mockImplementation(async () => json(groupsBody(group("todo", []))));
    const { refreshIssueGroups } = await import("../lib/api/issues");
    await refreshIssueGroups(DEFAULT_FILTERS, {}, true);
    expect(calledUrls()[0]!.searchParams.get("orderBy")).toBe("sortOrder");
  });
});
