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

describe("refreshIssueGroups", () => {
  it("re-reads as many pages as were loaded, and no more", async () => {
    fetchMock.mockImplementation(async (u: URL) => {
      const q = new URL(String(u)).searchParams;
      if (q.get("status") !== "todo") return json({ items: [], nextCursor: null });
      return q.get("cursor") ? json({ items: [row(2)], nextCursor: "c2" }) : json({ items: [row(1)], nextCursor: "c1" });
    });
    const { refreshIssueGroups } = await import("../lib/api/issues");
    const groups = await refreshIssueGroups(DEFAULT_FILTERS, { todo: 2 }, false);
    expect(groups.find((g) => g.status === "todo")).toMatchObject({ items: [{ id: "i1" }, { id: "i2" }], nextCursor: "c2" });
    expect(calledUrls().filter((u) => u.searchParams.get("status") === "todo")).toHaveLength(2);
    expect(calledUrls().filter((u) => u.searchParams.get("status") === "done")).toHaveLength(1);
  });

  it("lists by board position for the board", async () => {
    fetchMock.mockImplementation(async () => json({ items: [], nextCursor: null }));
    const { refreshIssueGroups } = await import("../lib/api/issues");
    await refreshIssueGroups(DEFAULT_FILTERS, {}, true);
    expect(calledUrls()[0]!.searchParams.get("orderBy")).toBe("sortOrder");
  });
});
