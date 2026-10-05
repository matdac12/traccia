// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertRow, removeRow } from "../components/inline-edit/rows";
import { IssuesView, type IssuesData } from "../components/issues-table/issues-view";
import { DEFAULT_FILTERS, type IssueFilters } from "../lib/issue-filters";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/issues" }));
vi.mock("../app/(app)/issues/board-actions", () => ({ loadMoreBoardIssues: vi.fn(), moveBoardIssue: vi.fn() }));
vi.mock("../app/(app)/issues/actions", () => ({ loadMoreIssues: vi.fn() }));
const update = vi.fn();
const del = vi.fn();
const restore = vi.fn();
const subIssue = vi.fn();
vi.mock("../app/(app)/issues/[identifier]/actions", () => ({
  updateIssueAction: (...a: unknown[]) => update(...a),
  deleteIssueAction: (...a: unknown[]) => del(...a),
  restoreIssueAction: (...a: unknown[]) => restore(...a),
  createSubIssueAction: (...a: unknown[]) => subIssue(...a),
  searchIssuesAction: vi.fn().mockResolvedValue({ ok: true, issues: [] }),
}));

const bug = { id: "l1", name: "bug", color: "#f00", projectId: null };
const T0 = "2026-01-01T00:00:00.000Z";
const issue = (n: number, status: string, over = {}) => ({
  id: `i${n}`, projectId: "p1", key: "TRK", number: n, description: "", parentId: null, createdAt: T0, identifier: `TRK-${n}`, title: `Issue ${n}`, status, priority: 2, estimate: 3, assignee: "you" as const,
  milestoneId: null, createdBy: "you" as const, updatedAt: T0, labels: [bug], ...over,
});
const project = (id: string, name: string) => ({ id, key: "TRK", name, description: "", status: "active", createdBy: "you", createdAt: T0, updatedAt: T0 });
const data = (): IssuesData => ({
  groups: ["backlog", "todo", "in_progress", "in_review", "done", "canceled"].map((status) => ({
    status, items: status === "todo" ? [issue(1, "todo")] : [], nextCursor: null,
  })) as IssuesData["groups"],
  projects: [project("p1", "Alpha"), project("p2", "Beta")] as IssuesData["projects"], labels: [bug],
  milestones: [{ id: "m1", projectId: "p1", name: "Launch", targetDate: null, updatedAt: T0 }, { id: "m2", projectId: "p2", name: "Elsewhere", targetDate: null, updatedAt: T0 }],
});
const setup = (filters: Partial<IssueFilters> = {}) => render(<IssuesView filters={{ ...DEFAULT_FILTERS, ...filters }} data={data()} />);
const rowOf = () => screen.getByRole("link", { name: "Issue 1" }).parentElement!.parentElement!;
const cardOf = () => screen.getByRole("link", { name: "Issue 1" }).closest("[data-state], .group") as HTMLElement;
const openWithRightClick = (el: Element) => fireEvent.contextMenu(el, { clientX: 10, clientY: 10 });
// jsdom has no layout, so moving the pointer from the submenu trigger to an item would close the submenu (grace area): select with a plain click.
const submenu = async (user: ReturnType<typeof userEvent.setup>, name: string, item: string | RegExp) => {
  await user.click(await screen.findByRole("menuitem", { name }));
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
};

beforeEach(() => { update.mockReset(); del.mockReset(); restore.mockReset(); subIssue.mockReset(); });

describe("row helpers", () => {
  const g = (status: string, ids: string[]) => ({ status, items: ids.map((id) => ({ id, status })), nextCursor: null }) as never;
  it("removes a row and puts it back at the top of its status group, once", () => {
    const groups = [g("todo", ["a", "b"]), g("done", ["c"])] as never[];
    const gone = removeRow(groups, "a") as { items: { id: string }[] }[];
    expect(gone[0]!.items.map((i) => i.id)).toEqual(["b"]);
    const back = insertRow(gone as never[], { id: "a", status: "todo" } as never) as { items: { id: string }[] }[];
    expect(back[0]!.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(insertRow(back as never[], { id: "a", status: "todo" } as never)).toBe(back);
  });
});

describe("context menu on table rows", () => {
  it("opens on right-click with every action", async () => {
    setup();
    openWithRightClick(rowOf());
    for (const name of ["Status", "Priority", "Assignee", "Labels", "Project", "Milestone", "Set parent…", "Add sub-issue…", "Copy identifier", "Copy link", "Open in new tab", "Delete"]) {
      expect(await screen.findByRole("menuitem", { name })).toBeInTheDocument();
    }
  });

  it("opens from the ... button and closes on Escape", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Actions for TRK-1" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("changes the status through the shared inline edit (If-Match token included)", async () => {
    update.mockResolvedValue({ ok: true, issue: issue(1, "done") });
    const user = userEvent.setup();
    setup();
    openWithRightClick(rowOf());
    await submenu(user, "Status", /Done/);
    expect(update).toHaveBeenCalledWith("TRK-1", { status: "done" }, T0);
  });

  it("offers only the milestones of the issue's project, and moves projects clearing parent and milestone", async () => {
    update.mockResolvedValue({ ok: true, issue: issue(1, "todo") });
    const user = userEvent.setup();
    setup();
    openWithRightClick(rowOf());
    await user.click(await screen.findByRole("menuitem", { name: "Milestone" }));
    expect(await screen.findByRole("menuitem", { name: "Launch" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Elsewhere" })).toBeNull();
    await user.keyboard("{Escape}{Escape}");
    openWithRightClick(rowOf());
    await submenu(user, "Project", "Beta");
    expect(update).toHaveBeenCalledWith("TRK-1", { project: "TRK" }, T0);
  });

  it("is fully keyboard operable: arrow keys open a submenu, Enter selects", async () => {
    update.mockResolvedValue({ ok: true, issue: issue(1, "todo") });
    const user = userEvent.setup();
    setup();
    openWithRightClick(rowOf());
    (await screen.findByRole("menuitem", { name: "Priority" })).focus();
    await user.keyboard("{ArrowRight}");
    const first = await screen.findByRole("menuitem", { name: /No priority/ });
    await waitFor(() => expect(first).toHaveFocus());
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}"); // No priority, Urgent, High, Medium, Low
    expect(update).toHaveBeenCalledWith("TRK-1", { priority: 4 }, T0);
  });

  it("shows the usual conflict notice for a stale write", async () => {
    update.mockResolvedValue({ ok: false, code: "conflict", message: "stale" });
    const user = userEvent.setup();
    setup();
    openWithRightClick(rowOf());
    await submenu(user, "Assignee", "Agent");
    expect(await screen.findByRole("alert")).toHaveTextContent("TRK-1 was changed by someone else");
  });

  it("deletes with an undo notice, and undo brings the row back", async () => {
    del.mockResolvedValue({ ok: true });
    restore.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    setup();
    openWithRightClick(rowOf());
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(del).toHaveBeenCalledWith("TRK-1");
    expect(screen.queryByRole("link", { name: "Issue 1" })).toBeNull();
    expect(await screen.findByRole("status")).toHaveTextContent("TRK-1 moved to Trash");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(restore).toHaveBeenCalledWith("TRK-1");
    expect(await screen.findByRole("link", { name: "Issue 1" })).toBeInTheDocument();
  });

  it("puts the row back when the delete fails", async () => {
    del.mockResolvedValue({ ok: false, code: "unknown", message: "boom" });
    const user = userEvent.setup();
    setup();
    openWithRightClick(rowOf());
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete TRK-1 (boom)");
    expect(screen.getByRole("link", { name: "Issue 1" })).toBeInTheDocument();
  });

  it("copies the identifier and the link", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup();
    openWithRightClick(rowOf());
    await user.click(await screen.findByRole("menuitem", { name: "Copy identifier" }));
    expect(writeText).toHaveBeenLastCalledWith("TRK-1");
    openWithRightClick(rowOf());
    await user.click(await screen.findByRole("menuitem", { name: "Copy link" }));
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/issues/TRK-1`);
  });

  it("adds a sub-issue from a dialog", async () => {
    subIssue.mockResolvedValue({ ok: true, issue: issue(2, "backlog") });
    const user = userEvent.setup();
    setup();
    openWithRightClick(rowOf());
    await user.click(await screen.findByRole("menuitem", { name: "Add sub-issue…" }));
    await user.type(await screen.findByLabelText("Sub-issue title"), "Child");
    await user.click(screen.getByRole("button", { name: "Create sub-issue" }));
    expect(subIssue).toHaveBeenCalledWith("TRK-1", "Child");
  });
});

describe("context menu on board cards", () => {
  it("opens on right-click and edits, without starting a drag", async () => {
    update.mockResolvedValue({ ok: true, issue: issue(1, "todo") });
    const user = userEvent.setup();
    setup({ view: "kanban" });
    openWithRightClick(cardOf());
    await submenu(user, "Priority", /Urgent/);
    expect(update).toHaveBeenCalledWith("TRK-1", { priority: 1 }, T0);
  });

  it("has the ... button and deletes with undo", async () => {
    del.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    setup({ view: "kanban" });
    await user.click(screen.getByRole("button", { name: "Actions for TRK-1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText(/TRK-1 moved to Trash/)).toBeInTheDocument(); // the board's drag live region also has role=status
    expect(screen.queryByRole("link", { name: "Issue 1" })).toBeNull();
  });
});
