// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Board } from "../components/kanban/board";
import { emptyColumns, type BoardColumn } from "../components/kanban/board-model";
import { IssueDetail } from "../components/issue-detail/issue-detail";
import { useListSync, type GroupsApplier } from "../components/issues-table/use-list-sync";
import { POLL_INTERVAL_MS } from "../lib/polling/use-poll";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/issues" }));
vi.mock("../app/(app)/issues/board-actions", () => ({ loadMoreBoardIssues: vi.fn(), moveBoardIssue: vi.fn() }));
vi.mock("../app/(app)/issues/[identifier]/actions", () => ({
  updateIssueAction: vi.fn(), deleteIssueAction: vi.fn(), restoreIssueAction: vi.fn(),
  createCommentAction: vi.fn(), deleteCommentAction: vi.fn(), updateCommentAction: vi.fn(), deleteAttachmentAction: vi.fn(), restoreAttachmentAction: vi.fn(),
}));

let captured: { onDragStart: (e: unknown) => void; onDragOver: (e: unknown) => void; onDragEnd: (e: unknown) => void } | null = null;
vi.mock("@dnd-kit/core", async (orig) => ({
  ...(await orig<typeof import("@dnd-kit/core")>()),
  DndContext: (props: { children: React.ReactNode } & NonNullable<typeof captured>) => { captured = props; return <>{props.children}</>; },
}));

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const urls = () => fetchMock.mock.calls.map(([u]) => String(u));

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const issue = (n: number, status: string, over = {}) => ({
  id: `i${n}`, projectId: "p1", identifier: `TRK-${n}`, title: `Issue ${n}`, status, priority: 1, estimate: null, assignee: "agent" as const,
  milestoneId: null, createdBy: "agent" as const, updatedAt: "2026-01-01T00:00:00.000Z", labels: [], ...over,
});
const group = (status: string, items: unknown[] = [], nextCursor: string | null = null) => ({ status, items, nextCursor });
const cols = (todo: unknown[]): BoardColumn[] => emptyColumns().map((c) => ({ ...c, items: c.status === "todo" ? (todo as BoardColumn["items"]) : [] }));
const allGroups = (todo: unknown[]) => ["backlog", "todo", "in_progress", "in_review", "done", "canceled"].map((s) => group(s, s === "todo" ? todo : []));

describe("useListSync", () => {
  const applier = (counts = {}, accepts = true): GroupsApplier & { apply: ReturnType<typeof vi.fn> } => ({ counts: () => counts, apply: vi.fn(() => accepts) });

  it("probes with `since`, and only reads the groups when something changed", async () => {
    fetchMock.mockImplementation(async (u: string) => (String(u).startsWith("/api/issues/changes") ? json({ latest: null }) : json([])));
    const a = applier();
    const { result } = renderHook(() => useListSync({ query: "view=kanban", syncToken: "2026-01-01T00:00:00.000Z" }));
    act(() => result.current.register(a));
    await advance(POLL_INTERVAL_MS);
    expect(urls()).toEqual(["/api/issues/changes?since=2026-01-01T00%3A00%3A00.000Z"]);
    expect(a.apply).not.toHaveBeenCalled();

    fetchMock.mockImplementation(async (u: string) => (String(u).startsWith("/api/issues/changes") ? json({ latest: "2026-01-01T00:00:05.000Z" }) : json(allGroups([issue(1, "todo")]))));
    await advance(POLL_INTERVAL_MS);
    expect(a.apply).toHaveBeenCalledTimes(1);
    expect(urls().at(-1)).toContain("/api/issues/groups?query=view%3Dkanban&counts=backlog%3A0%2Ctodo%3A0");
    // The next probe starts after the change just applied.
    await advance(POLL_INTERVAL_MS);
    expect(urls().filter((u) => u.includes("changes")).at(-1)).toContain("since=2026-01-01T00%3A00%3A05.000Z");
  });

  it("without a token the first probe only records the baseline", async () => {
    fetchMock.mockImplementation(async (u: string) => (String(u).startsWith("/api/issues/changes") ? json({ latest: "2026-02-02T00:00:00.000Z" }) : json([])));
    const a = applier();
    const { result } = renderHook(() => useListSync({ query: "" }));
    act(() => result.current.register(a));
    await advance(POLL_INTERVAL_MS);
    expect(urls()).toEqual(["/api/issues/changes"]);
    await advance(POLL_INTERVAL_MS);
    expect(urls()[1]).toBe("/api/issues/changes?since=2026-02-02T00%3A00%3A00.000Z");
  });

  it("retries a refused update on the next tick instead of losing it", async () => {
    fetchMock.mockImplementation(async (u: string) => (String(u).startsWith("/api/issues/changes") ? json({ latest: "2026-01-01T00:00:05.000Z" }) : json([])));
    const a = applier({}, false);
    const { result } = renderHook(() => useListSync({ query: "", syncToken: "2026-01-01T00:00:00.000Z" }));
    act(() => result.current.register(a));
    await advance(POLL_INTERVAL_MS * 2);
    expect(a.apply).toHaveBeenCalledTimes(2);
    expect(urls().filter((u) => u.includes("changes")).every((u) => u.includes("since=2026-01-01T00%3A00%3A00.000Z"))).toBe(true);
  });

  it("discards an answer when the shown counts changed while it was in flight", async () => {
    let counts: Record<string, number> = { todo: 1 };
    const a: GroupsApplier & { apply: ReturnType<typeof vi.fn> } = { counts: () => counts, apply: vi.fn(() => true) };
    fetchMock.mockImplementation(async (u: string) => {
      if (String(u).startsWith("/api/issues/changes")) return json({ latest: "2026-01-01T00:00:05.000Z" });
      counts = { todo: 51 }; // "load more" landed meanwhile
      return json([]);
    });
    const { result } = renderHook(() => useListSync({ query: "", syncToken: "2026-01-01T00:00:00.000Z" }));
    act(() => result.current.register(a));
    await advance(POLL_INTERVAL_MS);
    expect(a.apply).not.toHaveBeenCalled();
  });

  it("backs off after a failed probe", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useListSync({ query: "", syncToken: "x" }));
    await advance(POLL_INTERVAL_MS);
    expect(result.current.failures).toBe(1);
    await advance(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("Board live refresh", () => {
  const setup = (todo: unknown[]) => {
    let reg: GroupsApplier | null = null;
    render(<Board columns={cols(todo)} query="" register={(a) => { reg = a; }} />);
    return () => reg!;
  };
  const drag = (h: NonNullable<typeof captured>, id: string, overId: string) => {
    const e = { active: { id, rect: { current: { translated: null } } }, over: { id: overId, rect: null } };
    return e;
  };

  it("swaps in fresh groups when idle, and reports what is shown", () => {
    const applier = setup([issue(1, "todo")]);
    expect(applier().counts().todo).toBe(1);
    let taken = false;
    act(() => { taken = applier().apply(allGroups([issue(1, "todo"), issue(2, "todo", { title: "From the agent" })]) as never); });
    expect(taken).toBe(true);
    expect(screen.getByRole("link", { name: "From the agent" })).toBeInTheDocument();
  });

  it("refuses an update while a drag is in progress, and takes it after the drop", () => {
    const applier = setup([issue(1, "todo"), issue(2, "todo")]);
    const e = drag(captured!, "i1", "done");
    act(() => captured!.onDragStart(e));
    let taken = true;
    act(() => { taken = applier().apply(allGroups([]) as never); });
    expect(taken).toBe(false);
    expect(screen.getByRole("link", { name: "Issue 1" })).toBeInTheDocument();
    act(() => captured!.onDragEnd({ ...e, over: null })); // dropped nowhere: cancelled
    act(() => { taken = applier().apply(allGroups([issue(2, "todo")]) as never); });
    expect(taken).toBe(true);
    expect(screen.queryByRole("link", { name: "Issue 1" })).toBeNull();
  });
});

describe("external delete (MAT-1765)", () => {
  it("a poll after an external delete removes the card", async () => {
    const sync = renderHook(() => useListSync({ query: "", syncToken: "2026-01-01T00:00:00.000Z" }));
    render(<Board columns={cols([issue(1, "todo"), issue(2, "todo")])} query="" register={sync.result.current.register} />);
    expect(screen.getByRole("link", { name: "Issue 1" })).toBeInTheDocument();
    // The API bumps updatedAt on soft delete, so the probe now reports a newer change and the groups omit the row.
    fetchMock.mockImplementation(async (u: string) => (String(u).startsWith("/api/issues/changes") ? json({ latest: "2026-01-01T00:00:09.000Z" }) : json(allGroups([issue(2, "todo")]))));
    await advance(POLL_INTERVAL_MS);
    expect(screen.queryByRole("link", { name: "Issue 1" })).toBeNull();
    expect(screen.getByRole("link", { name: "Issue 2" })).toBeInTheDocument();
  });
});

describe("IssueDetail live refresh", () => {
  const detail = (over = {}) => ({
    ...issue(7, "todo", { description: "Original", createdAt: "2026-01-01T00:00:00.000Z" }), key: "TRK", number: 7,
    comments: [], activity: [], attachments: [], children: [], relations: { blockedBy: [], blocks: [] }, parentId: null, ...over,
  });
  const mount = (d = detail()) =>
    render(<IssueDetail issue={d as never} projects={[{ id: "p1", key: "TRK", name: "Traccia" }]} labels={[]} milestones={[]} parent={null} />);

  it("applies a newer copy when nothing is being edited", async () => {
    mount();
    fetchMock.mockResolvedValue(json(detail({ title: "Renamed by agent", updatedAt: "2026-01-01T00:01:00.000Z" })));
    await advance(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledWith("/api/issues/TRK-7", expect.anything());
    expect(screen.getByLabelText("Title")).toHaveValue("Renamed by agent");
    expect(screen.queryByTestId("stale-banner")).toBeNull();
  });

  it("never overwrites an open description editor: it shows 'updated by an agent, reload' instead", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "My unsaved text" } });
    fetchMock.mockResolvedValue(json(detail({
      description: "Agent text", updatedAt: "2026-01-01T00:01:00.000Z",
      activity: [{ id: "a1", issueId: "i7", actor: "agent", type: "updated", data: {}, createdAt: "2026-01-01T00:01:00.000Z" }],
    })));
    await advance(POLL_INTERVAL_MS);
    expect(screen.getByLabelText("Description")).toHaveValue("My unsaved text");
    expect(screen.getByTestId("stale-banner")).toHaveTextContent("TRK-7 was updated by an agent");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(screen.queryByLabelText("Description")).toBeNull();
    expect(screen.getByText("Agent text")).toBeInTheDocument();
    expect(screen.queryByTestId("stale-banner")).toBeNull();
  });

  it("keeps a typed title draft, but still adds new comments", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My new title" } });
    const comment = { id: "c1", issueId: "i7", parentId: null, body: "Agent says hi", author: "agent", createdAt: "2026-01-01T00:01:00.000Z", updatedAt: "2026-01-01T00:01:00.000Z", replies: [] };
    fetchMock.mockResolvedValue(json(detail({ title: "Other title", updatedAt: "2026-01-01T00:01:00.000Z", comments: [comment] })));
    await advance(POLL_INTERVAL_MS);
    expect(screen.getByLabelText("Title")).toHaveValue("My new title");
    expect(screen.getByText("Agent says hi")).toBeInTheDocument();
    expect(screen.getByTestId("stale-banner")).toBeInTheDocument();
  });

  it("shows the last-updated indicator and an error state when polls fail", async () => {
    mount();
    expect(screen.getByTestId("live-status")).toHaveTextContent("Live");
    fetchMock.mockResolvedValue(json({}, 500));
    await advance(POLL_INTERVAL_MS);
    expect(screen.getByTestId("live-status")).toHaveTextContent("Can't refresh");
  });
});
