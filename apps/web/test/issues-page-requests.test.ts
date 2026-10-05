import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../lib/api/client";

// MAT-1761: a /issues load is at most three API requests, the layout's sidebar included.
const fetchMock = vi.fn();
vi.mock("../lib/api/client", async (orig) => {
  const mod = await orig<typeof import("../lib/api/client")>();
  const client = mod.createApiClient({ baseUrl: "http://api", token: "t", fetch: ((...a: unknown[]) => fetchMock(...a)) as never });
  return { ...mod, api: () => client };
});
vi.mock("@/components/issues-table/issues-view", () => ({ IssuesView: () => null }));

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
beforeEach(() => {
  fetchMock.mockReset();
  void createApiClient;
  fetchMock.mockImplementation(async (u: URL) => {
    const path = new URL(String(u)).pathname;
    if (path === "/v1/issues/groups") return json({ groups: [], syncToken: "t" });
    if (path === "/v1/projects") return json({ items: [{ id: "p1", key: "K", name: "P", description: "", status: "active", createdBy: "you", createdAt: "a", updatedAt: "a", milestones: [{ id: "m1", projectId: "p1", name: "M", targetDate: null, updatedAt: "a" }] }], nextCursor: null });
    if (path === "/v1/labels") return json({ items: [], nextCursor: null });
    return new Response("unexpected " + path, { status: 500 });
  });
});

describe("/issues page data", () => {
  it("loads groups, projects with milestones and labels in three requests", async () => {
    const { default: Page } = await import("../app/(app)/issues/page");
    const element = (await Page({ searchParams: Promise.resolve({}) })) as { props: { data: { milestones: unknown[]; syncToken: string } } };
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(element.props.data.milestones).toHaveLength(1);
    expect(element.props.data.syncToken).toBe("t");
  });
});
