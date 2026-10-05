// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Board } from "../components/kanban/board";
import { emptyColumns, type BoardColumn } from "../components/kanban/board-model";

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
