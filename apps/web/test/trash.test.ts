import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api/client";
import type { TrashItem } from "../lib/api/schemas";
import { batchPeers, deletedByText, itemHref, purgeConfirmation, restoreSummary } from "../components/trash/trash-model";

const restoreItem = vi.fn();
const purgeItem = vi.fn();
vi.mock("../lib/api/trash", () => ({ restoreItem: (...a: unknown[]) => restoreItem(...a), purgeItem: (...a: unknown[]) => purgeItem(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { purgeAction, restoreAction } = await import("../app/(app)/trash/actions");

const item = (o: Partial<TrashItem>): TrashItem => ({
  type: "issue", id: "i1", label: "MAT-1 Fix it", deletedAt: "2026-10-05T10:00:00Z", deletedBatch: "b1", issueId: null,
  parentId: null, projectId: "p1", projectName: "P", deletedBy: "you", ...o,
});

beforeEach(() => {
  restoreItem.mockReset();
  purgeItem.mockReset();
});

describe("restore", () => {
  it("restores the batch and reports what came back", async () => {
    const counts = { projects: 0, milestones: 0, issues: 1, comments: 2, attachments: 1 };
    restoreItem.mockResolvedValue({ type: "issue", id: "i1", counts });
    const out = await restoreAction("issue", "i1");
    expect(restoreItem).toHaveBeenCalledWith("issue", "i1");
    expect(out.ok && restoreSummary(out.result)).toBe("Restored 1 issue, 2 comments and 1 attachment.");
  });
  it("shows the API message when a parent is still deleted", async () => {
    restoreItem.mockRejectedValue(new ApiError(409, "conflict", "Cannot restore comment: its issue is deleted. Restore the issue first."));
    expect(await restoreAction("comment", "c1")).toEqual({
      ok: false, code: "conflict", message: "Cannot restore comment: its issue is deleted. Restore the issue first.",
    });
  });
  it("rejects an unknown type without calling the API", async () => {
    expect((await restoreAction("label", "x")).ok).toBe(false);
    expect(restoreItem).not.toHaveBeenCalled();
  });
});

describe("purge", () => {
  it("purges and succeeds", async () => {
    purgeItem.mockResolvedValue({ purged: true });
    expect(await purgeAction("project", "p1")).toEqual({ ok: true });
    expect(purgeItem).toHaveBeenCalledWith("project", "p1");
  });
  it("displays a forbidden purge", async () => {
    purgeItem.mockRejectedValue(new ApiError(403, "forbidden", "This actor is not allowed to purge"));
    expect(await purgeAction("issue", "i1")).toEqual({ ok: false, code: "forbidden", message: "Purge is not allowed for this actor." });
  });
  it("displays an unreachable API", async () => {
    purgeItem.mockRejectedValue(new ApiError(0, "unreachable", "boom"));
    const out = await purgeAction("issue", "i1");
    expect(!out.ok && out.message).toMatch(/unreachable/);
  });
});

describe("purge confirmation", () => {
  const all = [
    item({}),
    item({ type: "comment", id: "c1", label: "hi", issueId: "i1" }),
    item({ type: "comment", id: "c2", label: "yo", issueId: "i1", deletedBatch: "older" }),
    item({ type: "attachment", id: "a1", label: "x.png", issueId: "i1" }),
    item({ type: "issue", id: "other", label: "MAT-9 Other", deletedBatch: "b9" }),
  ];
  it("names the item, says it cannot be undone and counts what goes with it", () => {
    const c = purgeConfirmation(all[0]!, all);
    expect(c.name).toBe("MAT-1 Fix it");
    expect(c.warning).toBe("This cannot be undone.");
    expect(c.withIt).toBe("This also permanently removes 2 comments and 1 attachment deleted with it.");
  });
  it("counts a project's issues, comments and attachments exactly, from any batch", () => {
    const p = item({ type: "project", id: "p1", label: "P", deletedBatch: "bp" });
    const tree = [
      p,
      item({ id: "i1", deletedBatch: "bp" }),
      item({ id: "i2", parentId: "i1", deletedBatch: "older" }),
      item({ type: "comment", id: "c1", issueId: "i2", deletedBatch: "older2" }),
      item({ type: "milestone", id: "m1", label: "M", deletedBatch: "bp" }),
      item({ id: "x", projectId: "other", deletedBatch: "bx" }),
    ];
    expect(purgeConfirmation(p, tree).withIt).toBe("This also permanently removes 1 milestone, 2 issues and 1 comment deleted with it.");
  });
  it("counts an issue's sub-issue tree and their comments, but not a sibling's", () => {
    const tree = [
      item({ id: "i1" }),
      item({ id: "i2", parentId: "i1", deletedBatch: "old" }),
      item({ id: "i3", parentId: "i2", deletedBatch: "old2" }),
      item({ id: "sib", parentId: null, deletedBatch: "b9" }),
      item({ type: "comment", id: "c1", issueId: "i3", deletedBatch: "old3" }),
      item({ type: "comment", id: "c2", issueId: "sib", deletedBatch: "b9" }),
    ];
    expect(purgeConfirmation(tree[0]!, tree).withIt).toBe("This also permanently removes 2 issues and 1 comment deleted with it.");
  });
  it("says who deleted an item", () => {
    expect(deletedByText(item({ deletedBy: "you" }))).toBe("by you");
    expect(deletedByText(item({ deletedBy: "agent" }))).toBe("by an agent");
    expect(deletedByText(item({ deletedBy: null }))).toBe("");
  });
  it("badge counts only what a restore brings back", () => {
    expect(batchPeers(all[0]!, all).map((i) => i.id)).toEqual(["c1", "a1"]);
  });
  it("has no children line for a lone item", () => {
    expect(purgeConfirmation(all[4]!, all).withIt).toBeNull();
  });
});

describe("links", () => {
  it("links issues by identifier, projects by id, comments to their issue", () => {
    expect(itemHref(item({}))).toBe("/issues/MAT-1");
    expect(itemHref(item({ type: "project", id: "p1", label: "P" }))).toBe("/projects/p1");
    expect(itemHref(item({ type: "comment", issueId: "i1" }))).toBe("/issues/i1");
    expect(itemHref(item({ type: "milestone" }))).toBeNull();
  });
});
