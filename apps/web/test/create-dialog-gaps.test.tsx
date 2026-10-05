// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api/client";

const createLabel = vi.fn();
vi.mock("@/lib/api/labels", () => ({ createLabel: (...a: unknown[]) => createLabel(...a) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const createIssueAction = vi.fn();
const loadOptions = vi.fn();
vi.mock("../components/create-issue/actions", () => ({
  createIssueAction: (...a: unknown[]) => createIssueAction(...a),
  loadCreateIssueOptions: (...a: unknown[]) => loadOptions(...a),
}));
const labelAction = vi.fn();
const searchIssuesAction = vi.fn();
const linkSubIssueAction = vi.fn();
const createSubIssueAction = vi.fn();
vi.mock("../app/(app)/issues/label-actions", () => ({ createLabelInPlaceAction: (...a: unknown[]) => labelAction(...a) }));
vi.mock("../app/(app)/issues/[identifier]/actions", () => ({
  searchIssuesAction: (...a: unknown[]) => searchIssuesAction(...a),
  linkSubIssueAction: (...a: unknown[]) => linkSubIssueAction(...a),
  createSubIssueAction: (...a: unknown[]) => createSubIssueAction(...a),
}));

const real = await vi.importActual<typeof import("../app/(app)/issues/label-actions")>("../app/(app)/issues/label-actions");
const { CreateIssueDialog } = await import("../components/create-issue/create-issue-dialog");
const { SubIssues } = await import("../components/issue-detail/relations");

// jsdom lacks the pointer-capture and scroll APIs Radix Select calls.
Object.assign(Element.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} });

beforeEach(() => {
  for (const f of [createLabel, revalidatePath, createIssueAction, loadOptions, labelAction, searchIssuesAction, linkSubIssueAction, createSubIssueAction]) f.mockReset();
  loadOptions.mockResolvedValue({ ok: true, data: { labels: [], milestones: [] } });
});

describe("createLabelInPlaceAction", () => {
  it("creates a project-scoped label and refreshes", async () => {
    createLabel.mockResolvedValue({ id: "l1", name: "bug", color: "#ff0000", projectId: "P1" });
    const res = await real.createLabelInPlaceAction("P1", { name: "bug", color: "#ff0000", scoped: true });
    expect(res).toMatchObject({ ok: true, data: { id: "l1" } });
    expect(createLabel).toHaveBeenCalledWith({ name: "bug", color: "#ff0000", project: "P1" });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("creates a global label when not scoped", async () => {
    createLabel.mockResolvedValue({ id: "l2" });
    await real.createLabelInPlaceAction("P1", { name: "bug", color: "#ff0000", scoped: false });
    expect(createLabel).toHaveBeenCalledWith({ name: "bug", color: "#ff0000", project: null });
  });
  it("validates before calling the API", async () => {
    const res = await real.createLabelInPlaceAction("P1", { name: " ", color: "red", scoped: true });
    expect(res).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String), color: expect.any(String) } });
    expect(createLabel).not.toHaveBeenCalled();
  });
  it("passes a duplicate-name conflict through", async () => {
    createLabel.mockRejectedValue(new ApiError(409, "conflict", "A label named bug already exists"));
    expect(await real.createLabelInPlaceAction("P1", { name: "bug", color: "#ff0000", scoped: true })).toMatchObject({ ok: false, error: "A label named bug already exists" });
  });
});

describe("create-issue dialog", () => {
  const open = () => render(<CreateIssueDialog open onOpenChange={() => {}} projects={[{ id: "P1", name: "Alpha" }]} />);

  it("sends the chosen estimate and parent", async () => {
    searchIssuesAction.mockResolvedValue({ ok: true, issues: [{ id: "i9", identifier: "ALP-9", title: "Epic", status: "todo" }] });
    createIssueAction.mockResolvedValue({ ok: true, data: { identifier: "ALP-10", labelError: null } });
    const user = userEvent.setup();
    open();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Child");
    await user.click(screen.getByRole("combobox", { name: "Estimate" }));
    await user.click(await screen.findByRole("option", { name: "5 points" }));
    await user.click(screen.getByRole("button", { name: "Parent" }));
    await user.type(screen.getByRole("textbox", { name: "Search issues" }), "epic");
    await user.click(await screen.findByRole("button", { name: /ALP-9/ }));
    await user.click(screen.getByRole("button", { name: "Create issue" }));
    await waitFor(() => expect(createIssueAction).toHaveBeenCalledWith(expect.objectContaining({ title: "Child", estimate: 5, parentId: "i9" })));
  });

  it("creates a label in place and selects it", async () => {
    labelAction.mockResolvedValue({ ok: true, data: { id: "l7", name: "ux", color: "#123456", projectId: "P1" } });
    createIssueAction.mockResolvedValue({ ok: true, data: { identifier: "ALP-1", labelError: null } });
    const user = userEvent.setup();
    open();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Polish");
    await user.click(await screen.findByRole("button", { name: /Create label/ }));
    await user.type(screen.getByRole("textbox", { name: "Label name" }), "ux");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(labelAction).toHaveBeenCalledWith("P1", { name: "ux", color: "#6b7280", scoped: true }));
    expect(await screen.findByRole("button", { name: "ux", pressed: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create issue" }));
    await waitFor(() => expect(createIssueAction).toHaveBeenCalledWith(expect.objectContaining({ labels: ["ux"] })));
  });
});

describe("sub-issues panel", () => {
  it("links an existing issue", async () => {
    searchIssuesAction.mockResolvedValue({ ok: true, issues: [{ id: "i5", identifier: "ALP-5", title: "Loose end", status: "todo" }] });
    linkSubIssueAction.mockResolvedValue({ ok: true, issue: {} });
    const user = userEvent.setup();
    render(<SubIssues parentIdentifier="ALP-1" items={[]} />);
    await user.click(screen.getByRole("button", { name: /Add/ }));
    await user.click(screen.getByRole("button", { name: "Link existing" }));
    await user.type(screen.getByRole("textbox", { name: "Search issues" }), "loose");
    await user.click(await screen.findByRole("button", { name: /ALP-5/ }));
    await waitFor(() => expect(linkSubIssueAction).toHaveBeenCalledWith("ALP-1", "ALP-5"));
    expect(createSubIssueAction).not.toHaveBeenCalled();
  });
  it("shows the API's refusal and keeps the picker open", async () => {
    searchIssuesAction.mockResolvedValue({ ok: true, issues: [{ id: "i5", identifier: "OTH-5", title: "Elsewhere", status: "todo" }] });
    linkSubIssueAction.mockResolvedValue({ ok: false, code: "validation_error", message: "parent must be in the same project" });
    const user = userEvent.setup();
    render(<SubIssues parentIdentifier="ALP-1" items={[]} />);
    await user.click(screen.getByRole("button", { name: /Add/ }));
    await user.click(screen.getByRole("button", { name: "Link existing" }));
    await user.type(screen.getByRole("textbox", { name: "Search issues" }), "else");
    await user.click(await screen.findByRole("button", { name: /OTH-5/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("same project");
  });
  it("still creates a new sub-issue", async () => {
    createSubIssueAction.mockResolvedValue({ ok: true, issue: {} });
    const user = userEvent.setup();
    render(<SubIssues parentIdentifier="ALP-1" items={[]} />);
    await user.click(screen.getByRole("button", { name: /Add/ }));
    await user.type(screen.getByRole("textbox", { name: "Sub-issue title" }), "New child");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createSubIssueAction).toHaveBeenCalledWith("ALP-1", "New child"));
  });
});

describe("issue detail label dropdown", () => {
  it("creates a label for the issue's project and applies it", async () => {
    labelAction.mockResolvedValue({ ok: true, data: { id: "l7", name: "ux", color: "#123456", projectId: "P1" } });
    const { Properties } = await import("../components/issue-detail/properties");
    const onChange = vi.fn();
    const issue = { id: "i1", projectId: "P1", key: "ALP", identifier: "ALP-1", status: "todo", priority: 0, estimate: null, assignee: null, milestoneId: null, labels: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const user = userEvent.setup();
    render(<Properties issue={issue as never} projects={[{ id: "P1", key: "ALP", name: "Alpha" }]} labels={[]} milestones={[]} parent={null} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Labels" }));
    await user.click(await screen.findByRole("menuitem", { name: /Create label/ }));
    await user.type(screen.getByRole("textbox", { name: "Label name" }), "ux");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(labelAction).toHaveBeenCalledWith("P1", { name: "ux", color: "#6b7280", scoped: true }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("label ux", expect.any(Function), { labels: [expect.objectContaining({ name: "ux" })] }));
    const build = onChange.mock.calls[0]![1] as (c: unknown) => unknown;
    expect(build({ labels: [{ name: "bug" }] })).toEqual({ labels: ["bug", "ux"] });
  });
});
