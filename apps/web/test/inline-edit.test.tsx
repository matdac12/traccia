// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upsertRow } from "../components/inline-edit/rows";
import { IssuesView, type IssuesData } from "../components/issues-table/issues-view";
import { DEFAULT_FILTERS, type IssueFilters } from "../lib/issue-filters";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/issues" }));
vi.mock("../app/(app)/issues/board-actions", () => ({ loadMoreBoardIssues: vi.fn(), moveBoardIssue: vi.fn() }));
vi.mock("../app/(app)/issues/actions", () => ({ loadMoreIssues: vi.fn() }));
const update = vi.fn();
vi.mock("../app/(app)/issues/[identifier]/actions", () => ({ updateIssueAction: (...a: unknown[]) => update(...a) }));

const bug = { id: "l1", name: "bug", color: "#f00", projectId: null };
const ux = { id: "l2", name: "ux", color: "#0f0", projectId: "p1" };
const other = { id: "l3", name: "other-project", color: "#00f", projectId: "p2" };
const T0 = "2026-01-01T00:00:00.000Z";
const issue = (n: number, status: string, over = {}) => ({
  id: `i${n}`, projectId: "p1", key: "TRK", number: n, description: "", parentId: null, createdAt: T0, identifier: `TRK-${n}`, title: `Issue ${n}`, status, priority: 2, estimate: 3, assignee: "you" as const,
  milestoneId: null, createdBy: "you" as const, updatedAt: T0, labels: [bug], ...over,
});
const data = (): IssuesData => ({
  groups: ["backlog", "todo", "in_progress", "in_review", "done", "canceled"].map((status) => ({
    status, items: status === "todo" ? [issue(1, "todo")] : [], nextCursor: null,
  })) as IssuesData["groups"],
  projects: [], labels: [bug, ux, other], milestones: [],
});
const setup = (filters: Partial<IssueFilters> = {}) => render(<IssuesView filters={{ ...DEFAULT_FILTERS, ...filters }} data={data()} />);
const pick = async (user: ReturnType<typeof userEvent.setup>, trigger: string, item: string | RegExp) => {
  await user.click(screen.getByRole("button", { name: trigger }));
  await user.click(await screen.findByRole("menuitem", { name: item }));
};

beforeEach(() => update.mockReset());

describe("upsertRow", () => {
  const g = (status: string, ids: string[]) => ({ status, items: ids.map((id) => ({ id })) , nextCursor: null }) as never;
  it("replaces in place, or moves a changed status to the top of its group", () => {
    const groups = [g("todo", ["a", "b"]), g("done", ["c"])] as never[];
    expect((upsertRow(groups, { id: "b", status: "todo", title: "x" } as never)[0] as { items: { title?: string }[] }).items[1]!.title).toBe("x");
    const moved = upsertRow(groups, { id: "b", status: "done" } as never) as { items: { id: string }[] }[];
    expect(moved.map((x) => x.items.map((i) => i.id))).toEqual([["a"], ["b", "c"]]);
    expect(upsertRow(groups, { id: "zzz", status: "todo" } as never)).toBe(groups);
  });
});

describe("inline edit in the table", () => {
  it("changes the status optimistically with the row's updatedAt as the concurrency token", async () => {
    let resolve!: (v: unknown) => void;
    update.mockReturnValue(new Promise((r) => { resolve = r; }));
    const user = userEvent.setup();
    setup();
    await pick(user, "Change status of TRK-1", /In Progress/);
    expect(update).toHaveBeenCalledWith("TRK-1", { status: "in_progress" }, T0);
    // Shown before the server answers: the row moved to its new group.
    expect(screen.getByTestId("count-in_progress")).toHaveTextContent("1");
    expect(screen.queryByTestId("count-todo")).toBeNull();
    resolve({ ok: true, issue: issue(1, "in_progress", { updatedAt: "2026-01-02T00:00:00.000Z" }) });
    await waitFor(() => expect(screen.getByTestId("count-in_progress")).toHaveTextContent("1"));
  });

  it("edits priority and assignee", async () => {
    update.mockResolvedValue({ ok: true, issue: issue(1, "todo") });
    const user = userEvent.setup();
    setup();
    await pick(user, "Change priority of TRK-1", /Urgent/);
    expect(update).toHaveBeenLastCalledWith("TRK-1", { priority: 1 }, T0);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await pick(user, "Change assignee of TRK-1", /Agent/);
    expect(update).toHaveBeenLastCalledWith("TRK-1", { assignee: "agent" }, T0);
  });

  it("toggles labels from global and own-project labels only", async () => {
    update.mockResolvedValue({ ok: true, issue: issue(1, "todo", { labels: [bug, ux] }) });
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Change labels of TRK-1" }));
    expect(screen.queryByRole("menuitem", { name: /other-project/ })).toBeNull();
    await user.click(await screen.findByRole("menuitem", { name: /ux/ }));
    expect(update).toHaveBeenCalledWith("TRK-1", { labels: ["bug", "ux"] }, T0);
  });

  it("puts the row back and says so when the save fails", async () => {
    update.mockResolvedValue({ ok: false, code: "unknown", message: "boom" });
    const user = userEvent.setup();
    setup();
    await pick(user, "Change priority of TRK-1", /Low/);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not change priority to Low of TRK-1 (boom)");
    expect(within(screen.getByRole("button", { name: "Change priority of TRK-1" })).getByRole("img")).toHaveAccessibleName("High");
  });

  it("shows the conflict notice with the current issue, and re-applies against it", async () => {
    update.mockResolvedValueOnce({ ok: false, code: "conflict", message: "stale", current: issue(1, "todo", { updatedAt: "2026-01-03T00:00:00.000Z", labels: [bug, ux] }) });
    const user = userEvent.setup();
    setup();
    await pick(user, "Change labels of TRK-1", /bug/);
    await user.keyboard("{Escape}"); // the label menu stays open for more toggles
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("TRK-1 was changed by someone else");
    expect(notice).toHaveTextContent("not saved");
    update.mockResolvedValueOnce({ ok: true, issue: issue(1, "todo", { labels: [ux] }) });
    await user.click(screen.getByRole("button", { name: "Re-apply my change" }));
    // Rebuilt against the fresh issue: the other actor's `ux` label is kept, and the fresh token is sent.
    expect(update).toHaveBeenLastCalledWith("TRK-1", { labels: ["ux"] }, "2026-01-03T00:00:00.000Z");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("keeps the pickers out of the row link, which stays reachable", () => {
    setup();
    const link = screen.getByRole("link", { name: "Issue 1" });
    expect(link).toHaveAttribute("href", "/issues/TRK-1");
    expect(link.contains(screen.getByRole("button", { name: "Change status of TRK-1" }))).toBe(false);
  });
});

describe("inline edit on board cards", () => {
  it("edits priority and moves the card when the status changes", async () => {
    update.mockResolvedValue({ ok: true, issue: issue(1, "done", { updatedAt: "2026-01-02T00:00:00.000Z" }) });
    const user = userEvent.setup();
    setup({ view: "kanban" });
    await pick(user, "Change status of TRK-1", /Done/);
    expect(update).toHaveBeenCalledWith("TRK-1", { status: "done" }, T0);
    await waitFor(() => expect(screen.getByTestId("count-done")).toHaveTextContent("1"));
    expect(screen.getByTestId("count-todo")).toHaveTextContent("0");
  });

  it("shows the conflict notice on the board", async () => {
    update.mockResolvedValue({ ok: false, code: "conflict", message: "stale" });
    const user = userEvent.setup();
    setup({ view: "kanban" });
    await pick(user, "Change assignee of TRK-1", "Agent");
    expect(await screen.findByRole("alert")).toHaveTextContent("TRK-1 was changed by someone else");
  });
});
