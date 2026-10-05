import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../lib/api/client";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const fetchMock = vi.fn();
vi.mock("../lib/api/client", async (orig) => {
  const mod = await orig<typeof import("../lib/api/client")>();
  const client = mod.createApiClient({ baseUrl: "http://api", token: "t", fetch: ((...a: unknown[]) => fetchMock(...a)) as never });
  return { ...mod, api: () => client };
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const issue = {
  id: "i1", projectId: "p1", key: "PIL", number: 1, identifier: "PIL-1", title: "T", description: "", status: "todo", priority: 0,
  estimate: null, assignee: null, milestoneId: null, parentId: null, createdBy: "you", createdAt: "a", updatedAt: "2026-01-01T00:00:01.000Z", labels: [],
};
const detail = { ...issue, updatedAt: "2026-01-01T00:00:09.000Z", comments: [], activity: [], attachments: [], children: [], relations: { blockedBy: [], blocks: [] } };
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit }));

beforeEach(() => {
  fetchMock.mockReset();
  revalidatePath.mockReset();
  void createApiClient;
});

async function actions() {
  return import("../app/(app)/issues/[identifier]/actions");
}

describe("updateIssueAction", () => {
  it("patches with If-Match, returns the updated issue and revalidates the page", async () => {
    fetchMock.mockResolvedValueOnce(json({ ...issue, status: "done" }));
    const { updateIssueAction } = await actions();
    const res = await updateIssueAction("PIL-1", { status: "done" }, issue.updatedAt);
    expect(res).toMatchObject({ ok: true, issue: { status: "done" } });
    const [call] = calls();
    expect(call!.url).toBe("http://api/v1/issues/PIL-1");
    expect(call!.init.method).toBe("PATCH");
    expect((call!.init.headers as Record<string, string>)["if-match"]).toBe(issue.updatedAt);
    expect(JSON.parse(call!.init.body as string)).toEqual({ status: "done" });
    expect(revalidatePath).toHaveBeenCalledWith("/issues/PIL-1");
  });

  it("on 409 saves nothing, returns the current issue, and does not retry", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: { code: "conflict", message: "Issue was modified since it was read", details: { currentUpdatedAt: detail.updatedAt } } }, 409))
      .mockResolvedValueOnce(json({ ...detail, status: "in_progress" }));
    const { updateIssueAction } = await actions();
    const res = await updateIssueAction("PIL-1", { title: "mine" }, issue.updatedAt);
    expect(res).toMatchObject({ ok: false, code: "conflict", current: { updatedAt: detail.updatedAt, status: "in_progress" } });
    const methods = calls().map((c) => c.init.method);
    expect(methods).toEqual(["PATCH", "GET"]);
  });

  it("re-applying on top of the current issue sends the fresh updatedAt", async () => {
    fetchMock.mockResolvedValueOnce(json({ ...issue, title: "mine", updatedAt: "2026-01-01T00:00:10.000Z" }));
    const { updateIssueAction } = await actions();
    const res = await updateIssueAction("PIL-1", { title: "mine" }, detail.updatedAt);
    expect(res.ok).toBe(true);
    expect((calls()[0]!.init.headers as Record<string, string>)["if-match"]).toBe(detail.updatedAt);
  });

  it("replaces whole label and blocker sets in one request", async () => {
    fetchMock.mockResolvedValueOnce(json(issue));
    const { updateIssueAction } = await actions();
    await updateIssueAction("PIL-1", { labels: ["bug"], blockedBy: ["PIL-2"], blocks: [] }, issue.updatedAt);
    expect(JSON.parse(calls()[0]!.init.body as string)).toEqual({ labels: ["bug"], blockedBy: ["PIL-2"], blocks: [] });
  });

  it("rejects malformed references, so nothing odd reaches the API path or revalidatePath", async () => {
    const { updateIssueAction, deleteIssueAction, searchIssuesAction } = await actions();
    expect(await updateIssueAction("../trash", { title: "x" }, "t")).toMatchObject({ ok: false, code: "validation_error" });
    expect(await deleteIssueAction("a/b")).toMatchObject({ ok: false });
    expect(await searchIssuesAction("x".repeat(500))).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects invalid input without calling the API, and surfaces API errors", async () => {
    const { updateIssueAction } = await actions();
    expect(await updateIssueAction("PIL-1", { title: "  " }, "x")).toMatchObject({ ok: false, code: "validation_error" });
    expect(await updateIssueAction("PIL-1", { expectedUpdatedAt: "x" }, "x")).toMatchObject({ ok: false, code: "validation_error" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json({ error: { code: "validation_error", message: "Unknown label \"nope\"" } }, 400));
    expect(await updateIssueAction("PIL-1", { labels: ["nope"] }, "x")).toEqual({ ok: false, code: "validation_error", message: 'Unknown label "nope"' });
  });
});

describe("comment actions", () => {
  it("reports forbidden when editing another actor's comment", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: "forbidden", message: "Only the actor who wrote a comment may edit it" } }, 403));
    const { updateCommentAction } = await actions();
    expect(await updateCommentAction("PIL-1", "c1", "edit")).toMatchObject({ ok: false, code: "forbidden" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("creates a reply with its parent id", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "c2", issueId: "i1", parentId: "c1", body: "hi", actor: "you", createdAt: "a", updatedAt: "a" }, 201));
    const { createCommentAction } = await actions();
    const res = await createCommentAction("PIL-1", "hi", "c1");
    expect(res.ok).toBe(true);
    expect(JSON.parse(calls()[0]!.init.body as string)).toEqual({ body: "hi", parentId: "c1" });
  });
  it("does not send empty comments", async () => {
    const { createCommentAction } = await actions();
    expect(await createCommentAction("PIL-1", "  ", null)).toMatchObject({ ok: false, code: "validation_error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("delete and undo", () => {
  it("soft-deletes then restores through the API", async () => {
    fetchMock.mockResolvedValueOnce(json({ type: "issue", id: "i1", batch: "b" })).mockResolvedValueOnce(json({ type: "issue", id: "i1", batch: "b", counts: { projects: 0, milestones: 0, issues: 1, comments: 0, attachments: 0 } }));
    const { deleteIssueAction, restoreIssueAction } = await actions();
    expect((await deleteIssueAction("PIL-1")).ok).toBe(true);
    expect((await restoreIssueAction("PIL-1")).ok).toBe(true);
    expect(calls().map((c) => `${c.init.method} ${c.url}`)).toEqual(["DELETE http://api/v1/issues/PIL-1", "POST http://api/v1/issues/PIL-1/restore"]);
  });
});

describe("sub-issues and blocker search", () => {
  it("creates a sub-issue under the parent in the parent's project, reading both from the API", async () => {
    fetchMock.mockResolvedValueOnce(json(issue)).mockResolvedValueOnce(json({ ...issue, id: "i2", identifier: "PIL-2", parentId: "i1" }, 201));
    const { createSubIssueAction } = await actions();
    await createSubIssueAction("PIL-1", " Child ");
    expect(JSON.parse(calls()[1]!.init.body as string)).toEqual({ project: "PIL", title: "Child", parentId: "i1" });
  });
  it("looks an identifier up directly and returns nothing for an unknown one", async () => {
    fetchMock.mockResolvedValueOnce(json(issue)).mockResolvedValueOnce(json({ error: { code: "not_found", message: "nope" } }, 404));
    const { searchIssuesAction } = await actions();
    expect(await searchIssuesAction("pil-1")).toMatchObject({ ok: true, issues: [{ identifier: "PIL-1" }] });
    expect(calls()[0]!.url).toBe("http://api/v1/issues/PIL-1");
    expect(await searchIssuesAction("PIL-99")).toEqual({ ok: true, issues: [] });
  });
  it("sends plain quoted words to the full-text search", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [], nextCursor: null }));
    const { searchIssuesAction } = await actions();
    await searchIssuesAction('login "bug" OR (x');
    expect(new URL(calls()[0]!.url).searchParams.get("q")).toBe('"login" "bug" "OR" "x"');
  });
});
