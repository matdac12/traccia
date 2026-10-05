// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssuesView, type IssuesData } from "../components/issues-table/issues-view";
import { buildSections, subIssueCounts } from "../components/issues-table/group-rows";
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
  { status: "todo", items: [issue(1, "todo", { priority: 1, assignee: "agent" }), issue(2, "todo", { parentId: "i1" })], nextCursor: null },
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
  it("counts finished sub-issues per parent", () => {
    expect(subIssueCounts(groups.flatMap((g) => g.items)).get("i1")).toEqual({ done: 1, total: 2 });
  });
});

describe("table display", () => {
  it("marks sub-issues with their parent and parents with progress", () => {
    setup();
    const marker = within(screen.getByRole("link", { name: "Issue 2" }).parentElement!).getByTestId("parent-marker");
    expect(marker).toHaveTextContent("TRK-1");
    expect(within(screen.getByRole("link", { name: "Issue 1" }).parentElement!).getByTestId("sub-progress")).toHaveTextContent("1/2");
    expect(within(screen.getByRole("link", { name: "Issue 1" }).parentElement!).queryByTestId("parent-marker")).toBeNull();
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
