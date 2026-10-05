// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssuesView, type IssuesData } from "../components/issues-table/issues-view";
import { SEARCH_DEBOUNCE_MS } from "../components/issues-table/filter-bar";
import { DEFAULT_FILTERS, type IssueFilters } from "../lib/issue-filters";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/issues" }));
const loadMore = vi.fn();
vi.mock("../app/(app)/issues/actions", () => ({ loadMoreIssues: (...a: unknown[]) => loadMore(...a) }));

const label = { id: "l1", name: "bug", color: "#f00", projectId: null };
const issue = (n: number, status: string, over = {}) => ({
  id: `i${n}`, projectId: "p1", identifier: `TRK-${n}`, title: `Issue ${n}`, status, priority: 2, estimate: 3, assignee: "you" as const,
  milestoneId: "m1", createdBy: "you" as const, updatedAt: new Date().toISOString(), labels: [label], ...over,
});
const data = (over: Partial<IssuesData> = {}): IssuesData => ({
  groups: [
    { status: "backlog", items: [issue(1, "backlog")], nextCursor: null },
    { status: "todo", items: [issue(2, "todo"), issue(3, "todo")], nextCursor: "cur" },
    { status: "in_progress", items: [], nextCursor: null },
    { status: "in_review", items: [], nextCursor: null },
    { status: "done", items: [issue(4, "done")], nextCursor: null },
    { status: "canceled", items: [], nextCursor: null },
  ] as IssuesData["groups"],
  projects: [{ id: "p1", name: "Traccia" }] as IssuesData["projects"],
  labels: [label],
  milestones: [{ id: "m1", projectId: "p1", name: "P8 Dashboard", targetDate: null }],
  ...over,
});
const setup = (filters: Partial<IssueFilters> = {}, d: IssuesData | undefined = data(), error?: string) =>
  render(<IssuesView filters={{ ...DEFAULT_FILTERS, ...filters }} data={d} error={error} />);

beforeEach(() => { replace.mockReset(); loadMore.mockReset(); });

describe("IssuesView table", () => {
  it("groups issues by status with counts, hiding empty groups; done starts collapsed", () => {
    setup();
    expect(screen.getByRole("button", { name: /Backlog/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("count-todo")).toHaveTextContent("2+");
    expect(screen.queryByRole("button", { name: /In Progress/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Done/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Issue 4")).toBeNull();
    expect(screen.getByRole("link", { name: /Issue 1/ })).toHaveAttribute("href", "/issues/TRK-1");
  });

  it("collapses and expands a group from the keyboard-reachable toggle", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Backlog/ }));
    expect(screen.queryByText("Issue 1")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Done/ }));
    expect(screen.getByText("Issue 4")).toBeInTheDocument();
  });

  it("loads more of one group through the cursor", async () => {
    loadMore.mockResolvedValue({ items: [issue(5, "todo")], nextCursor: null });
    setup({ q: "x" });
    await userEvent.setup().click(screen.getByRole("button", { name: /Load more todo/ }));
    expect(loadMore).toHaveBeenCalledWith({ query: "q=x", status: "todo", cursor: "cur" });
    expect(await screen.findByText("Issue 5")).toBeInTheDocument();
    expect(screen.getByTestId("count-todo")).toHaveTextContent("3");
    expect(screen.queryByRole("button", { name: /Load more/ })).toBeNull();
  });

  it("shows an error when loading more fails", async () => {
    loadMore.mockRejectedValue(new Error("boom"));
    setup();
    await userEvent.setup().click(screen.getByRole("button", { name: /Load more todo/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load more");
  });

  it("sorts by a header, flipping the direction on the active column", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Sort by Updated" }));
    expect(replace).toHaveBeenLastCalledWith("/issues?order=asc", { scroll: false });
    await user.click(screen.getByRole("button", { name: "Sort by ID" }));
    expect(replace).toHaveBeenLastCalledWith("/issues?sort=priority", { scroll: false });
  });
});

describe("IssuesView filters and URL sync", () => {
  it("writes every filter kind to the URL via the filter menu", async () => {
    const user = userEvent.setup();
    const pick = async (section: string, option: string | RegExp) => {
      await user.click(screen.getByRole("button", { name: "Filter" }));
      const trigger = screen.getByRole("menuitem", { name: new RegExp(section) });
      trigger.focus();
      await user.keyboard("{ArrowRight}");
      await user.click(await screen.findByRole("menuitemcheckbox", { name: option }));
    };
    setup();
    await pick("Project", "Traccia");
    expect(replace).toHaveBeenLastCalledWith("/issues?project=p1", { scroll: false });
    await user.keyboard("{Escape}{Escape}");
    await pick("Assignee", /Agent/);
    expect(replace).toHaveBeenLastCalledWith("/issues?assignee=agent", { scroll: false });
    await user.keyboard("{Escape}{Escape}");
    await pick("Labels", /bug/);
    expect(replace).toHaveBeenLastCalledWith("/issues?label=bug", { scroll: false });
    await user.keyboard("{Escape}{Escape}");
    await pick("Priority", /Urgent/);
    expect(replace).toHaveBeenLastCalledWith("/issues?priority=1", { scroll: false });
    await user.keyboard("{Escape}{Escape}");
    await pick("Milestone", "P8 Dashboard");
    expect(replace).toHaveBeenLastCalledWith("/issues?milestone=m1", { scroll: false });
  });

  it("shows active filters as removable chips from the URL state", async () => {
    setup({ project: "p1", labels: ["bug"], assignee: "none", priority: 1, milestone: "m1" });
    expect(screen.getByText("Traccia")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Remove label filter bug" }));
    expect(replace).toHaveBeenLastCalledWith("/issues?project=p1&assignee=none&priority=1&milestone=m1", { scroll: false });
  });

  it("debounces search into one URL update", () => {
    vi.useFakeTimers();
    try {
      setup();
      const box = screen.getByRole("searchbox", { name: "Search issues" });
      fireEvent.change(box, { target: { value: "c" } });
      fireEvent.change(box, { target: { value: "cache" } });
      act(() => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1); });
      expect(replace).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(1); });
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith("/issues?q=cache", { scroll: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("toggles the view and persists it in the URL", async () => {
    const user = userEvent.setup();
    const { rerender } = setup({ project: "p1" });
    await user.click(screen.getByRole("button", { name: "Board" }));
    expect(replace).toHaveBeenLastCalledWith("/issues?project=p1&view=kanban", { scroll: false });
    rerender(<IssuesView filters={{ ...DEFAULT_FILTERS, view: "kanban" }} data={data()} />);
    expect(screen.getByText("Board view is coming")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(replace).toHaveBeenLastCalledWith("/issues", { scroll: false });
  });
});

describe("IssuesView empty and error states", () => {
  const empty = data({ groups: data().groups.map((g) => ({ ...g, items: [], nextCursor: null })) });
  it("explains an empty tracker", () => {
    setup({}, empty);
    expect(screen.getByText("No issues yet")).toBeInTheDocument();
  });
  it("offers to clear filters when nothing matches", async () => {
    setup({ project: "p1", orderBy: "priority" }, empty);
    await userEvent.setup().click(within(screen.getByText("No issues match").closest("div")!).getByRole("button", { name: "Clear filters" }));
    expect(replace).toHaveBeenLastCalledWith("/issues?sort=priority", { scroll: false });
  });
  it("shows the API error instead of the table", () => {
    setup({}, undefined, "API unreachable");
    expect(screen.getByText("Could not load issues")).toBeInTheDocument();
    expect(screen.getByText("API unreachable")).toBeInTheDocument();
  });
});
