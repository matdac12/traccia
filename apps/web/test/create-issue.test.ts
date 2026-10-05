import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api/client";

const createIssue = vi.fn();
vi.mock("@/lib/api/issues", () => ({ createIssue: (...a: unknown[]) => createIssue(...a) }));
vi.mock("@/lib/api/labels", () => ({ listLabels: vi.fn(async () => [{ id: "l1", name: "bug", color: "#ff0000", projectId: null }]) }));
vi.mock("@/lib/api/milestones", () => ({ listMilestones: vi.fn(async () => []) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const { createIssueAction, loadCreateIssueOptions } = await import("../components/create-issue/actions");
const { parseCreateIssue } = await import("../components/create-issue/form");

const values = { title: "Fix it", description: "", project: "P1", status: "todo", priority: 2, assignee: null, milestoneId: null, labels: ["bug"] } as const;

beforeEach(() => {
  createIssue.mockReset();
  revalidatePath.mockReset();
});

describe("create-issue form validation", () => {
  it("accepts a valid form and drops the empty description", () => {
    const res = parseCreateIssue({ ...values, labels: [...values.labels] });
    expect(res).toMatchObject({ ok: true, labels: ["bug"], input: { project: "P1", title: "Fix it", status: "todo", priority: 2, assignee: null } });
    if (res.ok) expect(res.input.description).toBeUndefined();
  });
  it("rejects a blank title with a field error", () => {
    const res = parseCreateIssue({ ...values, labels: [], title: "   " });
    expect(res).toMatchObject({ ok: false, fieldErrors: { title: expect.any(String) } });
  });
  it("requires a project", () => {
    const res = parseCreateIssue({ ...values, labels: [], project: "" });
    expect(res).toMatchObject({ ok: false, fieldErrors: { project: expect.any(String) } });
  });
});

describe("createIssueAction", () => {
  it("does not call the API when the form is invalid", async () => {
    const res = await createIssueAction({ ...values, labels: [], title: "" });
    expect(res).toMatchObject({ ok: false, fieldErrors: { title: expect.any(String) } });
    expect(createIssue).not.toHaveBeenCalled();
  });
  it("creates the issue, passes labels separately and refreshes", async () => {
    createIssue.mockResolvedValue({ issue: { identifier: "MAT-7" }, labelError: null });
    const res = await createIssueAction({ ...values, labels: ["bug"] });
    expect(res).toEqual({ ok: true, data: { identifier: "MAT-7", labelError: null } });
    expect(createIssue).toHaveBeenCalledWith(expect.objectContaining({ project: "P1", title: "Fix it" }), ["bug"]);
    expect(revalidatePath).toHaveBeenCalled();
  });
  it("reports a label failure without failing the create", async () => {
    createIssue.mockResolvedValue({ issue: { identifier: "MAT-8" }, labelError: "unknown label" });
    const res = await createIssueAction({ ...values, labels: ["nope"] });
    expect(res).toEqual({ ok: true, data: { identifier: "MAT-8", labelError: "unknown label" } });
  });
  it("shows API validation errors per field", async () => {
    createIssue.mockRejectedValue(new ApiError(400, "validation_error", "Validation failed", { fields: { milestoneId: ["must belong to the project"] } }));
    const res = await createIssueAction({ ...values, labels: [], milestoneId: "m9" });
    expect(res).toEqual({ ok: false, error: "Validation failed", fieldErrors: { milestoneId: "must belong to the project" } });
  });
  it("turns an unreachable API into a message", async () => {
    createIssue.mockRejectedValue(new ApiError(0, "unreachable", "boom"));
    expect(await createIssueAction({ ...values, labels: [] })).toMatchObject({ ok: false, error: "Could not reach the API." });
  });
  it("rethrows unexpected errors", async () => {
    createIssue.mockRejectedValue(new TypeError("bug"));
    await expect(createIssueAction({ ...values, labels: [] })).rejects.toThrow("bug");
  });
});

describe("loadCreateIssueOptions", () => {
  it("returns labels and milestones for the project", async () => {
    const res = await loadCreateIssueOptions("P1");
    expect(res).toMatchObject({ ok: true, data: { labels: [{ name: "bug" }], milestones: [] } });
  });
});
