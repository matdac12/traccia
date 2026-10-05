import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FILTERS } from "../lib/issue-filters";

const request = vi.fn();
vi.mock("../lib/api/client", () => ({ api: () => ({ request }) }));
const { listIssueGroups, GROUP_PAGE_SIZE } = await import("../lib/api/issues");

beforeEach(() => request.mockReset().mockResolvedValue({ groups: [], syncToken: "t" }));

describe("listIssueGroups", () => {
  it("is one request for every status, with every filter forwarded and the sync token returned", async () => {
    request.mockResolvedValue({ groups: [], syncToken: "2026-01-01T00:00:00.000Z" });
    const out = await listIssueGroups({ ...DEFAULT_FILTERS, project: "p1", assignee: "none", labels: ["bug", "ui"], priority: 0, milestone: "m1", q: "cache", orderBy: "priority", order: "asc" });
    expect(out.syncToken).toBe("2026-01-01T00:00:00.000Z");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("/issues/groups");
    expect(request.mock.calls[0][1].query).toMatchObject({
      status: ["backlog", "todo", "in_progress", "in_review", "done", "canceled"],
      project: "p1", assignee: "none", label: ["bug", "ui"], priority: 0, milestone: "m1", q: "cache", orderBy: "priority", order: "asc", limit: GROUP_PAGE_SIZE,
    });
  });
});
