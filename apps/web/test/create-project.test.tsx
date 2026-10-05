// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api/client";

const createProject = vi.fn();
vi.mock("@/lib/api/projects", () => ({ createProject: (...a: unknown[]) => createProject(...a) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const action = vi.fn();
vi.mock("../app/(app)/projects/actions", () => ({ createProjectAction: (...a: unknown[]) => action(...a) }));

const real = await vi.importActual<typeof import("../app/(app)/projects/actions")>("../app/(app)/projects/actions");
const { NewProjectButton } = await import("../components/project/new-project-button");

beforeEach(() => {
  for (const f of [createProject, revalidatePath, push, action]) f.mockReset();
});

describe("createProjectAction", () => {
  it("creates with the default key, revalidates the layout and returns the id", async () => {
    createProject.mockResolvedValue({ id: "P1" });
    expect(await real.createProjectAction({ name: " Alpha ", description: "", status: "active" })).toEqual({ ok: true, data: { id: "P1" } });
    expect(createProject).toHaveBeenCalledWith({ name: "Alpha", status: "active" });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("rejects an empty name before calling the API", async () => {
    const res = await real.createProjectAction({ name: " ", description: "", status: "active" });
    expect(res).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    expect(createProject).not.toHaveBeenCalled();
  });
  it("passes API validation and 409 errors through", async () => {
    createProject.mockRejectedValue(new ApiError(409, "conflict", "A project named Alpha already exists"));
    expect(await real.createProjectAction({ name: "Alpha", description: "x", status: "paused" })).toEqual({ ok: false, error: "A project named Alpha already exists", fieldErrors: {} });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("New project dialog", () => {
  it("submits and navigates to the new project", async () => {
    action.mockResolvedValue({ ok: true, data: { id: "P9" } });
    const user = userEvent.setup();
    render(<NewProjectButton>New project</NewProjectButton>);
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Alpha");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "About");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith({ name: "Alpha", description: "About", status: "active" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/P9"));
  });
  it("shows field and API errors inline and stays open", async () => {
    action.mockResolvedValueOnce({ ok: false, error: "Fix the highlighted fields.", fieldErrors: { name: "is required" } });
    const user = userEvent.setup();
    render(<NewProjectButton>New project</NewProjectButton>);
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Fix the highlighted fields.");
    action.mockResolvedValueOnce({ ok: false, error: "A project named Alpha already exists", fieldErrors: {} });
    await user.click(await screen.findByRole("button", { name: "Create project" }));
    expect(await screen.findByText("A project named Alpha already exists")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
