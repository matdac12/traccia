import {
  activityQuerySchema,
  getProjectQuerySchema,
  listDocumentsQuerySchema,
  listIssueGroupsQuerySchema,
  listIssuesQuerySchema,
  listLabelsRequestQuerySchema,
  listMemoriesQuerySchema,
  listMilestonesRequestQuerySchema,
  listProjectsRequestQuerySchema,
  searchParamsRecord,
  searchQuerySchema,
  trashQuerySchema,
} from "@traccia/shared";
import type { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

// TRC-137: what each dashboard route asks the API for must satisfy the API's own (shared) query schema, so a
// request the API would answer with a 400 (TRC-136) fails here. Page loads only read, so there are no bodies;
// write bodies are checked against the shared schemas by the API client itself (api-client.test.ts).
// Each test imports a page cold, which is slow when the suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 });
const fetchMock = vi.fn();
vi.mock("../lib/api/client", async (orig) => {
  const mod = await orig<typeof import("../lib/api/client")>();
  const client = mod.createApiClient({ baseUrl: "http://api", token: "t", fetch: ((...a: unknown[]) => fetchMock(...a)) as never });
  return { ...mod, api: () => client };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/issues-table/issues-view", () => ({ IssuesView: () => null }));

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const project = { id: "p1", key: "K", name: "P", description: "d", status: "active", createdBy: "you", createdAt: "a", updatedAt: "a" };
const milestone = { id: "m1", projectId: "p1", name: "M", targetDate: null, updatedAt: "a", progress: { done: 1, total: 2 } };
const empty = { items: [], nextCursor: null };

/** The query schema the API validates each GET route with. */
const QUERY_SCHEMAS: [RegExp, z.ZodType][] = [
  [/^\/v1\/projects$/, listProjectsRequestQuerySchema],
  [/^\/v1\/projects\/[^/]+$/, getProjectQuerySchema],
  [/^\/v1\/projects\/[^/]+\/milestones$/, listMilestonesRequestQuerySchema],
  [/^\/v1\/projects\/[^/]+\/memories$/, listMemoriesQuerySchema],
  [/^\/v1\/projects\/[^/]+\/documents$/, listDocumentsQuerySchema],
  [/^\/v1\/labels$/, listLabelsRequestQuerySchema],
  [/^\/v1\/issues$/, listIssuesQuerySchema],
  [/^\/v1\/issues\/groups$/, listIssueGroupsQuerySchema],
  [/^\/v1\/search$/, searchQuerySchema],
  [/^\/v1\/activity$/, activityQuerySchema],
  [/^\/v1\/trash$/, trashQuerySchema],
];

/** Every request made so far, each parsed the way the API would parse it. */
function expectRequestsValid() {
  expect(fetchMock).toHaveBeenCalled();
  for (const [u] of fetchMock.mock.calls) {
    const url = new URL(String(u));
    const entry = QUERY_SCHEMAS.find(([path]) => path.test(url.pathname));
    expect(entry, `no schema for ${url.pathname}`).toBeDefined();
    const result = entry![1].safeParse(searchParamsRecord(url.searchParams));
    expect(result.success, `${url.pathname}${url.search}: ${result.success ? "" : result.error.message}`).toBe(true);
  }
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (u: URL) => {
    const path = new URL(String(u)).pathname;
    if (path === "/v1/projects/p1") return json(project);
    if (path === "/v1/projects") return json({ items: [{ ...project, milestones: [milestone] }], nextCursor: null });
    if (path === "/v1/projects/p1/milestones") return json({ items: [milestone], nextCursor: null });
    if (path === "/v1/issues/groups") return json({ groups: [], syncToken: "t" });
    if (["/v1/labels", "/v1/activity", "/v1/trash", "/v1/issues", "/v1/search", "/v1/projects/p1/memories", "/v1/projects/p1/documents"].includes(path)) return json(empty);
    return new Response("unexpected " + path, { status: 500 });
  });
});

describe("dashboard requests satisfy the API's query schemas", () => {
  it("Overview", async () => {
    const { default: Page } = await import("../app/(app)/projects/[id]/page");
    await Page({ params: Promise.resolve({ id: "p1" }) });
    expectRequestsValid();
  });

  it("Activity, first page and with a cursor", async () => {
    const { default: Page } = await import("../app/(app)/projects/[id]/activity/page");
    await Page({ params: Promise.resolve({ id: "p1" }) });
    expectRequestsValid();
    fetchMock.mockClear();
    const { listProjectActivity } = await import("../lib/api/activity");
    await listProjectActivity("p1", "abc");
    expectRequestsValid();
  });

  it("Issues, unfiltered and with every filter", async () => {
    const { default: Page } = await import("../app/(app)/projects/[id]/issues/page");
    await Page({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({}) });
    expectRequestsValid();
    fetchMock.mockClear();
    await Page({
      params: Promise.resolve({ id: "p1" }),
      searchParams: Promise.resolve({ status: ["todo", "in_progress"], assignee: "you", label: ["a", "b"], priority: "high", q: "foo bar", orderBy: "priority", order: "asc" }),
    });
    expectRequestsValid();
  });

  it("the global Issues list, as a table and as a board", async () => {
    const { default: Page } = await import("../app/(app)/issues/page");
    await Page({ searchParams: Promise.resolve({}) });
    expectRequestsValid();
    fetchMock.mockClear();
    await Page({ searchParams: Promise.resolve({ view: "kanban", status: "todo" }) });
    expectRequestsValid();
  });

  it("Issues paging, the change probe, the board and the picker's search", async () => {
    const issues = await import("../lib/api/issues");
    const { parseFilters } = await import("../lib/issue-filters");
    const filters = parseFilters({ q: "x" });
    await issues.listIssuePage(filters, "todo", "abc");
    await issues.listBoardPage(filters, "done");
    await issues.latestIssueChange("2026-01-01T00:00:00.000Z");
    await issues.latestIssueChange();
    await issues.findIssues("some words");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expectRequestsValid();
  });

  it("Trash, unfiltered, per type, with a cursor and with an unknown type", async () => {
    const { default: Page } = await import("../app/(app)/trash/page");
    await Page({ searchParams: Promise.resolve({}) });
    expectRequestsValid();
    for (const type of ["project", "milestone", "issue", "comment", "attachment", "todo"]) {
      fetchMock.mockClear();
      await Page({ searchParams: Promise.resolve({ type, cursor: "abc" }) });
      expectRequestsValid();
    }
    fetchMock.mockClear();
    await Page({ searchParams: Promise.resolve({ type: "bogus" }) });
    expectRequestsValid();
  });

  it("Settings makes no API request", async () => {
    const { default: Page } = await import("../app/(app)/settings/page");
    Page();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Documentation, unfiltered and filtered", async () => {
    const { default: MemoryPage } = await import("../app/(app)/projects/[id]/documentation/page");
    await MemoryPage({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({}) });
    expectRequestsValid();
    fetchMock.mockClear();
    await MemoryPage({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({ q: "foo", tag: "bar" }) });
    expectRequestsValid();
    fetchMock.mockClear();
    const { default: FilesPage } = await import("../app/(app)/projects/[id]/documentation/files/page");
    await FilesPage({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({}) });
    await FilesPage({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({ q: "spec" }) });
    expectRequestsValid();
  });
});
