// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api/client";

const api = { updateProject: vi.fn(), deleteProject: vi.fn(), restoreItem: vi.fn() };
vi.mock("@/lib/api/projects", () => ({ updateProject: (...a: unknown[]) => api.updateProject(...a), deleteProject: (...a: unknown[]) => api.deleteProject(...a) }));
vi.mock("@/lib/api/trash", () => ({ restoreItem: (...a: unknown[]) => api.restoreItem(...a) }));
vi.mock("@/lib/api/labels", () => ({}));
vi.mock("@/lib/api/milestones", () => ({}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const real = await vi.importActual<typeof import("../app/(app)/projects/[id]/actions")>("../app/(app)/projects/[id]/actions");
const rename = vi.fn();
const del = vi.fn();
const restore = vi.fn();
vi.mock("../app/(app)/projects/[id]/actions", () => ({
  updateProjectNameAction: (...a: unknown[]) => rename(...a),
  deleteProjectAction: (...a: unknown[]) => del(...a),
  restoreProjectAction: (...a: unknown[]) => restore(...a),
}));
const { ProjectTitle } = await import("../components/project/project-title");
const { ProjectDeletedGate, DeleteProjectButton } = await import("../components/project/project-delete");

beforeEach(() => {
  for (const f of [...Object.values(api), revalidatePath, rename, del, restore]) f.mockReset();
});

describe("project actions", () => {
  it("renames with the last seen updatedAt and never sends a key", async () => {
    api.updateProject.mockResolvedValue({});
    expect(await real.updateProjectNameAction("P1", " Beta ", "T1")).toEqual({ ok: true, data: undefined });
    expect(api.updateProject).toHaveBeenCalledWith("P1", { name: "Beta", expectedUpdatedAt: "T1" });
  });
  it("rejects an empty name before calling the API", async () => {
    expect(await real.updateProjectNameAction("P1", " ", "T1")).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    expect(api.updateProject).not.toHaveBeenCalled();
  });
  it("marks a stale rename as a conflict", async () => {
    api.updateProject.mockRejectedValue(new ApiError(409, "conflict", "stale", { currentUpdatedAt: "T2" }));
    expect(await real.updateProjectNameAction("P1", "Beta", "T1")).toMatchObject({ ok: false, conflict: true });
  });
  it("soft deletes without revalidating, and restore refreshes the layout", async () => {
    api.deleteProject.mockResolvedValue({ deleted: true });
    expect(await real.deleteProjectAction("P1")).toEqual({ ok: true, data: undefined });
    expect(api.deleteProject).toHaveBeenCalledWith("P1");
    expect(revalidatePath).not.toHaveBeenCalled();
    api.restoreItem.mockResolvedValue({});
    expect(await real.restoreProjectAction("P1")).toEqual({ ok: true, data: undefined });
    expect(api.restoreItem).toHaveBeenCalledWith("project", "P1");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});

describe("ProjectTitle", () => {
  it("shows the key and renames inline", async () => {
    rename.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(<ProjectTitle projectId="p1" name="Alpha" projectKey="ALP" updatedAt="T1" />);
    expect(screen.getByText("ALP")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rename project" }));
    const box = screen.getByRole("textbox", { name: "Project name" });
    await user.clear(box);
    await user.type(box, "Beta{Enter}");
    await waitFor(() => expect(rename).toHaveBeenCalledWith("p1", "Beta", "T1"));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });
  it("keeps the draft on a conflict and shows an inline validation error", async () => {
    rename.mockResolvedValueOnce({ ok: false, error: "stale", fieldErrors: {}, conflict: true });
    const user = userEvent.setup();
    render(<ProjectTitle projectId="p1" name="Alpha" projectKey="ALP" updatedAt="T1" />);
    await user.click(screen.getByRole("button", { name: "Rename project" }));
    const box = screen.getByRole("textbox", { name: "Project name" });
    await user.clear(box);
    await user.type(box, "Mine{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(/changed by someone else.*not saved/);
    expect(box).toHaveValue("Mine");
    rename.mockResolvedValueOnce({ ok: false, error: "bad", fieldErrors: { name: "is too long" } });
    await user.type(box, "{Enter}");
    expect(await screen.findByText("Name is too long")).toBeInTheDocument();
  });
});

describe("delete project", () => {
  function page() {
    render(
      <ProjectDeletedGate projectId="p1" projectKey="ALP" name="Alpha">
        <DeleteProjectButton projectId="p1" />
        <p>page body</p>
      </ProjectDeletedGate>,
    );
  }
  it("asks to confirm, then shows the Trash notice, and Undo restores the page", async () => {
    del.mockResolvedValue({ ok: true, data: undefined });
    restore.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole("button", { name: "Delete project" }));
    expect(del).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Delete project and its issues/ }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Alpha.*moved to Trash/);
    expect(screen.queryByText("page body")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Undo/ }));
    expect(await screen.findByText("page body")).toBeInTheDocument();
    expect(restore).toHaveBeenCalledWith("p1");
  });
  it("shows the error and keeps the page when delete fails", async () => {
    del.mockResolvedValue({ ok: false, error: "nope", fieldErrors: {} });
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole("button", { name: "Delete project" }));
    await user.click(screen.getByRole("button", { name: /Delete project and its issues/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(screen.getByText("page body")).toBeInTheDocument();
  });
});
