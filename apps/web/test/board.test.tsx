// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Board } from "../components/kanban/board";
import { emptyColumns, type BoardColumn } from "../components/kanban/board-model";

let captured: { onDragStart: (e: unknown) => void; onDragOver: (e: unknown) => void; onDragEnd: (e: unknown) => void } | null = null;
// jsdom cannot do real pointer drags: capture the DndContext handlers and call them with synthetic events.
vi.mock("@dnd-kit/core", async (orig) => ({
  ...(await orig<typeof import("@dnd-kit/core")>()),
  DndContext: (props: { children: React.ReactNode } & NonNullable<typeof captured>) => { captured = props; return <>{props.children}</>; },
}));
vi.mock("../app/(app)/issues/board-actions", () => ({ loadMoreBoardIssues: vi.fn(), moveBoardIssue: vi.fn() }));

const label = { id: "l1", name: "bug", color: "#f00", projectId: null };
const issue = (n: number, status: string, over = {}) => ({
  id: `i${n}`, projectId: "p1", identifier: `TRK-${n}`, title: `Issue ${n}`, status, priority: 1, estimate: 3, assignee: "agent" as const,
  milestoneId: null, createdBy: "agent" as const, updatedAt: new Date().toISOString(), labels: [label], ...over,
});
const columns = (): BoardColumn[] => emptyColumns().map((c) => ({
  ...c,
  items: c.status === "todo" ? [issue(1, "todo"), issue(2, "todo")] as BoardColumn["items"] : [],
  nextCursor: c.status === "todo" ? "cur" : null,
}));

describe("Board", () => {
  it("renders a column per status with cards linking to the issue", () => {
    render(<Board columns={columns()} query="view=kanban" />);
    expect(screen.getAllByRole("region")).toHaveLength(6);
    expect(screen.getByTestId("count-todo")).toHaveTextContent("2+");
    expect(screen.getByRole("link", { name: "Issue 1" })).toHaveAttribute("href", "/issues/TRK-1");
    expect(screen.getAllByText("No issues")).toHaveLength(5);
  });

  it("loads more of one column through the cursor, ignoring duplicates", async () => {
    const loadMore = vi.fn().mockResolvedValue({ items: [issue(2, "todo"), issue(3, "todo")], nextCursor: null });
    render(<Board columns={columns()} query="view=kanban" loadMore={loadMore} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Load more todo/ }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Issue 3" })).toBeInTheDocument());
    expect(loadMore).toHaveBeenCalledWith({ query: "view=kanban", status: "todo", cursor: "cur" });
    expect(screen.getByTestId("count-todo")).toHaveTextContent("3");
    expect(screen.getAllByRole("link", { name: "Issue 2" })).toHaveLength(1);
  });

  it("shows an error when loading more fails", async () => {
    render(<Board columns={columns()} query="" loadMore={vi.fn().mockRejectedValue(new Error("x"))} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Load more todo/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load more todo issues.");
  });
});

describe("Board drop handling", () => {
  type Handlers = { onDragStart: (e: unknown) => void; onDragOver: (e: unknown) => void; onDragEnd: (e: unknown) => void };
  const drop = (h: Handlers, id: string, overId: string) => {
    const e = { active: { id, rect: { current: { translated: null } } }, over: { id: overId, rect: null } };
    h.onDragStart(e);
    h.onDragOver(e);
    h.onDragEnd(e);
  };
  const cols = (): BoardColumn[] => emptyColumns().map((c) => ({ ...c, items: c.status === "todo" ? [issue(1, "todo"), issue(2, "todo")] as BoardColumn["items"] : [] }));

  it("moves optimistically, sends neighbour ids, and keeps the move on success", async () => {
    const move = vi.fn().mockResolvedValue({ ok: true, issue: issue(1, "done", { updatedAt: "2030-01-01T00:00:00.000Z" }) });
    render(<Board columns={cols()} query="" move={move} />);
    act(() => drop(captured!, "i1", "done"));
    expect(screen.getByTestId("count-done")).toHaveTextContent("1");
    await waitFor(() => expect(move).toHaveBeenCalledWith({ identifier: "TRK-1", status: "done", expectedUpdatedAt: expect.any(String) }));
    expect(screen.getByTestId("count-todo")).toHaveTextContent("1");
  });

  it("rolls back and shows the 409 message when the move fails", async () => {
    const move = vi.fn().mockResolvedValue({ ok: false, code: "conflict", message: "stale" });
    render(<Board columns={cols()} query="" move={move} />);
    act(() => drop(captured!, "i1", "done"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/TRK-1 was changed elsewhere.*undone/);
    expect(screen.getByTestId("count-done")).toHaveTextContent("0");
    expect(screen.getByTestId("count-todo")).toHaveTextContent("2");
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["Issue 1", "Issue 2"]);
  });

  it("rolls back when the action throws", async () => {
    render(<Board columns={cols()} query="" move={vi.fn().mockRejectedValue(new Error("down"))} />);
    act(() => drop(captured!, "i2", "done"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not move TRK-2/);
    expect(screen.getByTestId("count-todo")).toHaveTextContent("2");
  });
});
