// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const updateDescription = vi.fn();
vi.mock("../app/(app)/projects/[id]/actions", () => ({
  updateProjectDescriptionAction: (...a: unknown[]) => updateDescription(...a),
  updateProjectStatusAction: vi.fn(),
  createMilestoneAction: vi.fn(),
  deleteMilestoneAction: vi.fn(),
  updateMilestoneAction: vi.fn().mockResolvedValue({ ok: false, error: "stale", fieldErrors: {}, conflict: true }),
}));

const { ProjectDescription } = await import("../components/project/project-description");
const { MilestonesPanel } = await import("../components/project/milestones-panel");

describe("project page conflicts", () => {
  it("sends the last seen updatedAt, and on a 409 keeps the draft and says nothing was saved", async () => {
    updateDescription.mockResolvedValue({ ok: false, error: "stale", fieldErrors: {}, conflict: true });
    const user = userEvent.setup();
    render(<ProjectDescription projectId="p1" description="old" updatedAt="T1" />);
    await user.click(screen.getByRole("button", { name: /Edit/ }));
    const box = screen.getByRole("textbox", { name: "Description" });
    await user.clear(box);
    await user.type(box, "mine");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateDescription).toHaveBeenCalledWith("p1", "mine", "T1"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/changed by someone else.*not saved/);
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("mine");
  });

  it("shows the same notice when a milestone edit is stale", async () => {
    const user = userEvent.setup();
    const m = { id: "m1", projectId: "p1", name: "Beta", targetDate: null, updatedAt: "T1" };
    render(<MilestonesPanel projectId="p1" milestones={[m]} />);
    await user.click(screen.getByRole("button", { name: /Edit/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/changed by someone else.*not saved/);
  });
});
