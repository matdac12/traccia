// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssuesView, type IssuesData } from "../components/issues-table/issues-view";
import { buildSections, nestRows, STATUS_DISPLAY_ORDER, subIssueCounts } from "../components/issues-table/group-rows";
import { DEFAULT_FILTERS, type IssueFilters } from "../lib/issue-filters";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/issues" }));
vi.mock("../app/(app)/issues/board-actions", () => ({ loadMoreBoardIssues: vi.fn(), moveBoardIssue: vi.fn() }));
vi.mock("../app/(app)/issues/actions", () => ({ loadMoreIssues: vi.fn() }));

const issue = (n: number, status: string, over = {}) => ({
  id: `i${n}`, projectId: "p1", identifier: `TRK-${n}`, title: `Issue ${n}`, status, priority: 2, estimate: null, assignee: null,
  milestoneId: null, parentId: null, createdBy: "you" as const, createdAt: `2026-01-0${n}T00:00:00.000Z`, updatedAt: `2026-02-0${n}T00:00:00.000Z`, labels: [], ...over,
});
const groups = [
  { status: "todo", items: [issue(1, "todo", { priority: 1, assignee: "agent", createdBy: "agent" }), issue(2, "todo", { parentId: "i1" })], nextCursor: null },
  { status: "done", items: [issue(3, "done", { parentId: "i1", priority: 4 })], nextCursor: "c" },
] as unknown as IssuesData["groups"];
const data: IssuesData = { groups, projects: [{ id: "p1", name: "Traccia" }] as IssuesData["projects"], labels: [], milestones: [] };
const setup = (filters: Partial<IssueFilters> = {}) => render(<IssuesView filters={{ ...DEFAULT_FILTERS, ...filters }} data={data} />);

beforeEach(() => replace.mockReset());

describe("group rows", () => {
  const lookups = { projects: data.projects, milestones: [] };
  it("regroups the pooled rows by priority in priority order, re-sorted", () => {
    const s = buildSections(groups, "priority", DEFAULT_FILTERS, lookups);
    expect(s.map((x) => [x.title, x.items.map((i) => i.id)])).toEqual([["Urgent", ["i1"]], ["High", ["i2"]], ["Low", ["i3"]]]);
  });
  it("groups by assignee with Unassigned, or into one section", () => {
    expect(buildSections(groups, "assignee", DEFAULT_FILTERS, lookups).map((x) => x.title)).toEqual(["Agent", "Unassigned"]);
    expect(buildSections(groups, "none", { ...DEFAULT_FILTERS, orderBy: "title", order: "asc" }, lookups)[0]!.items.map((i) => i.id)).toEqual(["i1", "i2", "i3"]);
  });
  it("orders status groups In Progress, In Review, Todo, Backlog, Done, Canceled, whatever order the API returned", () => {
    const workflow = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"];
    const all = workflow.map((s, n) => ({ status: s, items: [issue(n + 1, s)], nextCursor: s === "backlog" ? "c" : null })) as unknown as IssuesData["groups"];
    expect(STATUS_DISPLAY_ORDER).toEqual(["in_progress", "in_review", "todo", "backlog", "done", "canceled"]);
    const keys = buildSections(all, "status", DEFAULT_FILTERS, lookups).map((x) => x.key);
    expect(keys).toEqual(["in_progress", "in_review", "todo", "backlog", "done", "canceled"]);
    // Empty groups stay hidden, and the input (API order, per-status cursors) is not reordered.
    const partial = [all[0]!, { ...all[1]!, items: [] }, all[3]!, all[4]!];
    expect(buildSections(partial, "status", DEFAULT_FILTERS, lookups).map((x) => x.key)).toEqual(["in_review", "backlog", "done"]);
    expect(all.map((g) => g.status)).toEqual(workflow);
  });
  it("nests sub-issues right after their parent and says where the connectors go", () => {
    const rows = [issue(1, "todo"), issue(2, "todo", { parentId: "i4" }), issue(3, "todo", { parentId: "i1" }), issue(4, "todo", { parentId: "i1" }), issue(5, "todo", { parentId: "i4" }), issue(6, "todo", { parentId: "elsewhere" })] as unknown as Parameters<typeof nestRows>[0];
    const tree = nestRows(rows);
    expect(tree.map((t) => [t.row.id, t.depth, t.last])).toEqual([["i1", 0, true], ["i3", 1, false], ["i4", 1, true], ["i2", 2, false], ["i5", 2, true], ["i6", 0, true]]);
    // i2 and i5 sit under i4, which is the last child of i1: no line keeps going at its level.
    expect(tree.find((t) => t.row.id === "i2")!.guides).toEqual([false]);
  });
  it("returns only the roots, with no connector below them, when sub-issues are hidden", () => {
    const rows = [issue(1, "todo"), issue(3, "todo", { parentId: "i1" }), issue(6, "todo", { parentId: "elsewhere" })] as unknown as Parameters<typeof nestRows>[0];
    expect(nestRows(rows, false).map((t) => [t.row.id, t.depth, t.hasChildren])).toEqual([["i1", 0, false], ["i6", 0, false]]);
  });
  it("keeps rows that form a parent cycle, as roots", () => {
    const rows = [issue(1, "todo", { parentId: "i2" }), issue(2, "todo", { parentId: "i1" }), issue(3, "todo", { parentId: "i3" })] as unknown as Parameters<typeof nestRows>[0];
    expect(nestRows(rows).map((t) => [t.row.id, t.depth])).toEqual([["i3", 0], ["i1", 0], ["i2", 1]]);
  });
  it("counts finished sub-issues per parent", () => {
    expect(subIssueCounts(groups.flatMap((g) => g.items)).get("i1")).toEqual({ done: 1, total: 2 });
  });
});

describe("table display", () => {
  it("renders status sections in display order with their own load-more cursors", () => {
    const view = [{ status: "backlog", items: [issue(1, "backlog")], nextCursor: "cb" }, { status: "todo", items: [issue(2, "todo")], nextCursor: null }, { status: "in_progress", items: [issue(3, "in_progress")], nextCursor: null }, { status: "done", items: [issue(4, "done")], nextCursor: "cd" }] as unknown as IssuesData["groups"];
    render(<IssuesView filters={DEFAULT_FILTERS} data={{ ...data, groups: view }} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.replace(/[0-9+]+$/, ""))).toEqual(["In Progress", "Todo", "Backlog", "Done"]);
    expect(screen.getByTestId("count-backlog").textContent).toBe("1+");
    expect(screen.getByTestId("count-done").textContent).toBe("1+");
  });
  it("nests a sub-issue under its parent in the same section, without the parent marker, and shows the parent's progress", () => {
    setup();
    const child = screen.getByRole("link", { name: "Issue 2" }).closest("[data-depth]")!;
    expect(child).toHaveAttribute("data-depth", "1");
    expect(within(child as HTMLElement).queryByTestId("parent-marker")).toBeNull();
    const parent = screen.getByRole("link", { name: "Issue 1" }).closest("[data-depth]")!;
    expect(parent).toHaveAttribute("data-depth", "0");
    expect(within(parent as HTMLElement).getByTestId("sub-progress")).toHaveTextContent("1/2");
  });
  it("hides sub-issues from the Display menu, keeping the parent's progress", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Display" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Show sub-issues" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("link", { name: "Issue 2" })).toBeNull();
    const parent = screen.getByRole("link", { name: "Issue 1" }).closest("[data-depth]") as HTMLElement;
    expect(within(parent).getByTestId("sub-progress")).toHaveTextContent("1/2");
  });
  it("toggles sub-issues from the toolbar button, in step with the Display menu", async () => {
    const user = userEvent.setup();
    setup();
    const button = screen.getByRole("button", { name: "Parents only" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("link", { name: "Issue 2" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Display" }));
    expect(await screen.findByRole("menuitemcheckbox", { name: "Show sub-issues" })).not.toBeChecked();
    await user.keyboard("{Escape}");
    await user.click(button);
    expect(screen.getByRole("link", { name: "Issue 2" })).toBeInTheDocument();
  });
  it("marks a sub-issue with its parent when the parent is in another section", () => {
    setup({ groupBy: "priority" });
    const row = screen.getByRole("link", { name: "Issue 2" }).closest("[data-depth]")!;
    expect(row).toHaveAttribute("data-depth", "0");
    expect(within(row as HTMLElement).getByTestId("parent-marker")).toHaveTextContent("TRK-1");
  });
  it("does not add creator indicators to issue rows", () => {
    setup();
    expect(within(screen.getByRole("link", { name: "Issue 1" }).closest("[data-depth]") as HTMLElement).queryByRole("img", { name: "Created by the agent" })).toBeNull();
    expect(within(screen.getByRole("link", { name: "Issue 2" }).closest("[data-depth]") as HTMLElement).queryByRole("img", { name: "Created by the agent" })).toBeNull();
  });

  it("groups by the chosen field and offers loading the rest of every status", () => {
    setup({ groupBy: "priority" });
    expect(screen.getByRole("button", { name: /Urgent/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Todo/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Load more done/ })).toBeInTheDocument();
  });

  it("writes group and sort choices from the Display menu to the URL", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Display" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Assignee" }));
    expect(replace).toHaveBeenLastCalledWith("/issues?group=assignee", { scroll: false });
    await user.click(screen.getByRole("button", { name: "Display" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Title" }));
    expect(replace).toHaveBeenLastCalledWith("/issues?sort=title", { scroll: false });
  });

  it("shows the status filter as a chip that removes itself, in the board too", async () => {
    setup({ status: ["todo"], view: "kanban" });
    expect(screen.getByText("status:")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /Remove status filter/ }));
    expect(replace).toHaveBeenLastCalledWith("/issues?view=kanban", { scroll: false });
  });
});
