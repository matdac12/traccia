import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FILTERS } from "../lib/issue-filters";

const request = vi.fn();
vi.mock("../lib/api/client", () => ({ api: () => ({ request }) }));
const { listIssueGroups, GROUP_PAGE_SIZE } = await import("../lib/api/issues");

beforeEach(() => request.mockReset().mockResolvedValue({ items: [], nextCursor: null }));

describe("listIssueGroups", () => {
  it("fetches one bounded page per status with every filter forwarded to the API", async () => {
    await listIssueGroups({ ...DEFAULT_FILTERS, project: "p1", assignee: "none", labels: ["bug", "ui"], priority: 0, milestone: "m1", q: "cache", orderBy: "priority", order: "asc" });
    expect(request).toHaveBeenCalledTimes(6);
    const queries = request.mock.calls.map((c) => c[1].query);
    expect(queries.map((q) => q.status)).toEqual([["backlog"], ["todo"], ["in_progress"], ["in_review"], ["done"], ["canceled"]]);
    expect(queries[0]).toMatchObject({ project: "p1", assignee: "none", label: ["bug", "ui"], priority: 0, milestone: "m1", q: "cache", orderBy: "priority", order: "asc", limit: GROUP_PAGE_SIZE });
    expect(request.mock.calls[0][0]).toBe("/issues");
  });
});
