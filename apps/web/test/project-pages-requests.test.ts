import { beforeEach, describe, expect, it, vi } from "vitest";

// The project sub-pages: what each tab asks the API for.
const fetchMock = vi.fn();
vi.mock("../lib/api/client", async (orig) => {
  const mod = await orig<typeof import("../lib/api/client")>();
  const client = mod.createApiClient({ baseUrl: "http://api", token: "t", fetch: ((...a: unknown[]) => fetchMock(...a)) as never });
  return { ...mod, api: () => client };
});
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const project = { id: "p1", key: "K", name: "P", description: "d", status: "active", createdBy: "you", createdAt: "a", updatedAt: "a" };
const milestone = { id: "m1", projectId: "p1", name: "M", targetDate: null, updatedAt: "a", progress: { done: 1, total: 2 } };
const urls = () => fetchMock.mock.calls.map(([u]) => new URL(String(u)));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (u: URL) => {
    const url = new URL(String(u));
    const path = url.pathname;
    if (path === "/v1/projects/p1") return json(project);
    if (path === "/v1/projects") return json({ items: [{ ...project, milestones: [milestone] }], nextCursor: null });
    if (path === "/v1/projects/p1/milestones") return json({ items: [milestone], nextCursor: null });
    if (path === "/v1/labels") return json({ items: [], nextCursor: null });
    if (path === "/v1/issues/groups") return json({ groups: [], syncToken: "t" });
    if (path === "/v1/activity") return json({ items: [], nextCursor: null });
    return new Response("unexpected " + path, { status: 500 });
  });
});

describe("project pages", () => {
  it("Overview loads the project, milestones and labels, and no issues", async () => {
    const { default: Page } = await import("../app/(app)/projects/[id]/page");
    await Page({ params: Promise.resolve({ id: "p1" }) });
    const paths = urls().map((u) => u.pathname).sort();
    expect(paths).toEqual(["/v1/labels", "/v1/projects/p1", "/v1/projects/p1/milestones"]);
  });

  it("Activity asks for the activity feed of this project only, and reuses the project list's milestones", async () => {
    const { default: Page } = await import("../app/(app)/projects/[id]/activity/page");
    await Page({ params: Promise.resolve({ id: "p1" }) });
    const paths = urls().map((u) => u.pathname).sort();
    // The feed, the project itself and the shared project list; no separate milestones call (TRC-107).
    expect(paths).toEqual(["/v1/activity", "/v1/projects", "/v1/projects/p1"]);
    const feed = urls().find((u) => u.pathname === "/v1/activity");
    expect(feed?.searchParams.get("project")).toBe("p1");
  });

  it("Issues is scoped to the project whatever ?project= says, keeps the filters, and skips a milestones call", async () => {
    const { default: Page } = await import("../app/(app)/projects/[id]/issues/page");
    await Page({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({ project: "other", status: "todo" }) });
    const paths = urls().map((u) => u.pathname).sort();
    expect(paths).toEqual(["/v1/issues/groups", "/v1/labels", "/v1/projects", "/v1/projects/p1"]);
    const groups = urls().find((u) => u.pathname === "/v1/issues/groups");
    expect(groups?.searchParams.get("project")).toBe("p1");
    expect(groups?.searchParams.getAll("status")).toEqual(["todo"]);
  });

  it("a route key stands in for the project id in the reads, while the project read is authoritative", async () => {
    fetchMock.mockImplementation(async (u: URL) => {
      const url = new URL(String(u));
      if (url.pathname === "/v1/projects") return json({ items: [{ ...project, milestones: [milestone] }], nextCursor: null });
      if (url.pathname === "/v1/projects/K") return json({ ...project, id: "p1" });
      if (url.pathname === "/v1/activity") return json({ items: [], nextCursor: null });
      return new Response("unexpected " + url.pathname, { status: 500 });
    });
    const { default: Page } = await import("../app/(app)/projects/[id]/activity/page");
    await Page({ params: Promise.resolve({ id: "K" }) });
    expect(urls().find((u) => u.pathname === "/v1/activity")?.searchParams.get("project")).toBe("K");
  });

  it("an unknown project is a 404 on every tab", async () => {
    fetchMock.mockImplementation(async () => json({ error: { code: "not_found", message: "no" } }, 404));
    const pages = [import("../app/(app)/projects/[id]/page"), import("../app/(app)/projects/[id]/activity/page"), import("../app/(app)/projects/[id]/issues/page")];
    for (const { default: Page } of await Promise.all(pages)) {
      await expect(Page({ params: Promise.resolve({ id: "nope" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });
});
