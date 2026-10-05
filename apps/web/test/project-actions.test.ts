import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api/client";

const m = {
  createLabel: vi.fn(), updateLabel: vi.fn(), deleteLabel: vi.fn(),
  createMilestone: vi.fn(), updateMilestone: vi.fn(), deleteMilestone: vi.fn(),
  updateProject: vi.fn(),
};
vi.mock("@/lib/api/labels", () => ({ createLabel: (...a: unknown[]) => m.createLabel(...a), updateLabel: (...a: unknown[]) => m.updateLabel(...a), deleteLabel: (...a: unknown[]) => m.deleteLabel(...a) }));
vi.mock("@/lib/api/milestones", () => ({ createMilestone: (...a: unknown[]) => m.createMilestone(...a), updateMilestone: (...a: unknown[]) => m.updateMilestone(...a), deleteMilestone: (...a: unknown[]) => m.deleteMilestone(...a) }));
vi.mock("@/lib/api/projects", () => ({ updateProject: (...a: unknown[]) => m.updateProject(...a) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const actions = await import("../app/(app)/projects/[id]/actions");

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset().mockResolvedValue({});
  revalidatePath.mockReset();
});

describe("label flows", () => {
  it("creates a project-scoped label", async () => {
    expect(await actions.createLabelAction("P1", { name: "bug", color: "#ff0000", scoped: true })).toEqual({ ok: true, data: undefined });
    expect(m.createLabel).toHaveBeenCalledWith({ name: "bug", color: "#ff0000", project: "P1" });
    expect(revalidatePath).toHaveBeenCalledWith("/projects/P1");
  });
  it("creates a global label", async () => {
    await actions.createLabelAction("P1", { name: "bug", color: "#ff0000", scoped: false });
    expect(m.createLabel).toHaveBeenCalledWith({ name: "bug", color: "#ff0000", project: null });
  });
  it("rejects a bad color or empty name before calling the API", async () => {
    const res = await actions.createLabelAction("P1", { name: " ", color: "red", scoped: true });
    expect(res).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String), color: expect.any(String) } });
    expect(m.createLabel).not.toHaveBeenCalled();
  });
  it("shows a duplicate-name conflict from the API", async () => {
    m.createLabel.mockRejectedValue(new ApiError(409, "conflict", "A label named bug already exists"));
    expect(await actions.createLabelAction("P1", { name: "bug", color: "#ff0000", scoped: true })).toEqual({ ok: false, error: "A label named bug already exists", fieldErrors: {} });
  });
  it("renames and recolors", async () => {
    await actions.updateLabelAction("P1", "l1", { name: "defect", color: "#00ff00" });
    expect(m.updateLabel).toHaveBeenCalledWith("l1", { name: "defect", color: "#00ff00" });
  });
  it("deletes", async () => {
    expect(await actions.deleteLabelAction("P1", "l1")).toEqual({ ok: true, data: undefined });
    expect(m.deleteLabel).toHaveBeenCalledWith("l1");
  });
});

describe("milestone flows", () => {
  it("creates with a target date, or none when blank", async () => {
    await actions.createMilestoneAction("P1", { name: "Beta", targetDate: "2026-12-01" });
    expect(m.createMilestone).toHaveBeenLastCalledWith("P1", { name: "Beta", targetDate: "2026-12-01" });
    await actions.createMilestoneAction("P1", { name: "Beta", targetDate: "" });
    expect(m.createMilestone).toHaveBeenLastCalledWith("P1", { name: "Beta", targetDate: null });
  });
  it("rejects an impossible date", async () => {
    const res = await actions.createMilestoneAction("P1", { name: "Beta", targetDate: "2026-02-30" });
    expect(res).toMatchObject({ ok: false, fieldErrors: { targetDate: expect.any(String) } });
  });
  it("edits (clearing the date) and soft-deletes", async () => {
    await actions.updateMilestoneAction("P1", "m1", { name: "Beta 2", targetDate: "" });
    expect(m.updateMilestone).toHaveBeenCalledWith("m1", { name: "Beta 2", targetDate: null });
    await actions.deleteMilestoneAction("P1", "m1");
    expect(m.deleteMilestone).toHaveBeenCalledWith("m1");
  });
});

describe("project edits", () => {
  it("saves the description and the status", async () => {
    await actions.updateProjectDescriptionAction("P1", "# Hi");
    expect(m.updateProject).toHaveBeenLastCalledWith("P1", { description: "# Hi" });
    await actions.updateProjectStatusAction("P1", "paused");
    expect(m.updateProject).toHaveBeenLastCalledWith("P1", { status: "paused" });
  });
  it("rejects an unknown status", async () => {
    expect(await actions.updateProjectStatusAction("P1", "nope")).toMatchObject({ ok: false });
    expect(m.updateProject).not.toHaveBeenCalledWith("P1", { status: "nope" });
  });
});
