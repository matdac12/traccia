// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Milestone } from "../lib/api/schemas";

const actions = { create: vi.fn(), update: vi.fn(), remove: vi.fn() };
vi.mock("../app/(app)/projects/[id]/actions", () => ({
  createMilestoneAction: (...a: unknown[]) => actions.create(...a),
  updateMilestoneAction: (...a: unknown[]) => actions.update(...a),
  deleteMilestoneAction: (...a: unknown[]) => actions.remove(...a),
}));
const { MilestonesPanel } = await import("../components/project/milestones-panel");

const ms = (over: Partial<Milestone>): Milestone => ({ id: "m1", projectId: "p1", name: "Beta", description: "", targetDate: null, updatedAt: "T1", progress: { done: 1, total: 4 }, ...over });
const list = [
  ms({ id: "m1", name: "Alpha", description: "First cut", progress: { done: 4, total: 4 } }),
  ms({ id: "m2", name: "Beta", targetDate: "2026-03-09", progress: { done: 1, total: 4 } }),
  ms({ id: "m3", name: "Gamma", progress: { done: 0, total: 0 } }),
];
beforeEach(() => { for (const f of Object.values(actions)) f.mockReset().mockResolvedValue({ ok: true, data: undefined }); });

describe("milestone list", () => {
  it("renders one row per milestone with dot, name, percent, issue count and description", () => {
    render(<MilestonesPanel projectId="p1" milestones={list} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const [alpha, beta, gamma] = rows as HTMLElement[];
    expect(within(alpha).getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "/projects/p1/issues?milestone=m1");
    expect(alpha).toHaveTextContent("100%");
    expect(alpha).toHaveTextContent("4/4 issues");
    expect(alpha).toHaveTextContent("First cut");
    expect(within(alpha).getByTestId("milestone-dot")).toHaveAttribute("data-state", "done");
    expect(beta).toHaveTextContent("25%");
    expect(beta).toHaveTextContent("Target 9 Mar 2026");
    expect(within(beta).getByTestId("milestone-dot")).toHaveAttribute("data-state", "in_progress");
    expect(within(gamma).getByTestId("milestone-dot")).toHaveAttribute("data-state", "not_started");
    expect(gamma).toHaveTextContent("0/0 issues");
  });

  it("has Edit and Delete on every row and no empty strip when there are no milestones", () => {
    const { container, rerender } = render(<MilestonesPanel projectId="p1" milestones={list} />);
    for (const row of screen.getAllByRole("listitem")) {
      expect(within(row).getByRole("button", { name: /^Edit / })).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: /^Delete / })).toBeInTheDocument();
    }
    rerender(<MilestonesPanel projectId="p1" milestones={[]} />);
    expect(container.querySelector("ul")).toBeNull();
    expect(screen.getByText(/No milestones yet/)).toBeInTheDocument();
  });

  it("edits a milestone inline with its updatedAt", async () => {
    const user = userEvent.setup();
    render(<MilestonesPanel projectId="p1" milestones={list} />);
    await user.click(screen.getByRole("button", { name: "Edit Beta" }));
    const name = screen.getByRole("textbox", { name: "Milestone name" });
    expect(name).toHaveValue("Beta");
    await user.clear(name);
    await user.type(name, "Beta 2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.update).toHaveBeenCalledWith("p1", "m2", { name: "Beta 2", targetDate: "2026-03-09" }, "T1"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Milestone name" })).toBeNull());
  });

  it("asks before deleting, then deletes", async () => {
    const user = userEvent.setup();
    render(<MilestonesPanel projectId="p1" milestones={list} />);
    await user.click(screen.getByRole("button", { name: "Delete Gamma" }));
    expect(actions.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(actions.remove).toHaveBeenCalledWith("p1", "m3"));
  });

  it("shows a failed delete on the row", async () => {
    actions.remove.mockResolvedValue({ ok: false, error: "nope", fieldErrors: {} });
    const user = userEvent.setup();
    render(<MilestonesPanel projectId="p1" milestones={list} />);
    await user.click(screen.getByRole("button", { name: "Delete Gamma" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
  });

  it("adds a milestone from the + button", async () => {
    const user = userEvent.setup();
    render(<MilestonesPanel projectId="p1" milestones={[]} />);
    await user.click(screen.getByRole("button", { name: "Add milestone" }));
    await user.type(screen.getByRole("textbox", { name: "Milestone name" }), "Launch{Enter}");
    await waitFor(() => expect(actions.create).toHaveBeenCalledWith("p1", { name: "Launch", targetDate: "" }));
  });
});
