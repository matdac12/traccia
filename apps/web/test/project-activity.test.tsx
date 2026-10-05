// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityFeedItem } from "../lib/api/schemas";

const loadMore = vi.fn();
vi.mock("../app/(app)/projects/[id]/actions", () => ({ loadMoreActivityAction: (...a: unknown[]) => loadMore(...a) }));
const { ProjectActivity } = await import("../components/project/project-activity");

const row = (id: string, over: Partial<ActivityFeedItem> = {}): ActivityFeedItem => ({
  id, issueId: `i-${id}`, identifier: `TRC-${id}`, title: `Issue ${id}`, actor: "agent", type: "status_changed", data: { from: "todo", to: "done" }, createdAt: "2026-01-01T00:00:00.000Z", ...over,
});
const props = { projectId: "p1", milestoneNames: { m1: "Beta" }, projectNames: {} };
beforeEach(() => loadMore.mockReset());

describe("project activity", () => {
  it("lists rows newest first with actor, description, issue link and time", () => {
    render(<ProjectActivity {...props} initial={[row("2", { actor: "you", type: "milestone_changed", data: { from: null, to: "m1" } }), row("1")]} nextCursor={null} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("You");
    expect(items[0]).toHaveTextContent("changed milestone from none to Beta");
    expect(within(items[0]).getByRole("link")).toHaveAttribute("href", "/issues/TRC-2");
    expect(items[1]).toHaveTextContent("Agent");
    expect(items[1]).toHaveTextContent("changed status from Todo to Done");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows an empty state when the project has no activity", () => {
    render(<ProjectActivity {...props} initial={[]} nextCursor={null} />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("loads the next page with the cursor and hides the button at the end", async () => {
    loadMore.mockResolvedValue({ ok: true, data: { items: [row("2"), row("3")], nextCursor: null } });
    const user = userEvent.setup();
    render(<ProjectActivity {...props} initial={[row("1"), row("2")]} nextCursor="c1" />);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(loadMore).toHaveBeenCalledWith("p1", "c1");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("reports a failed page and keeps the button to retry", async () => {
    loadMore.mockResolvedValue({ ok: false, error: "API down", fieldErrors: {} });
    const user = userEvent.setup();
    render(<ProjectActivity {...props} initial={[row("1")]} nextCursor="c1" />);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("API down");
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  });
});
