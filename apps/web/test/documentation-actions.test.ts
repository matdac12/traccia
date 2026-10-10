import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api/client";

const m = {
  createMemory: vi.fn(), updateMemory: vi.fn(), deleteMemory: vi.fn(),
  updateDocument: vi.fn(), deleteDocument: vi.fn(), restoreDocumentation: vi.fn(),
};
vi.mock("@/lib/api/documentation", () => ({
  createMemory: (...a: unknown[]) => m.createMemory(...a), updateMemory: (...a: unknown[]) => m.updateMemory(...a), deleteMemory: (...a: unknown[]) => m.deleteMemory(...a),
  updateDocument: (...a: unknown[]) => m.updateDocument(...a), deleteDocument: (...a: unknown[]) => m.deleteDocument(...a), restoreDocumentation: (...a: unknown[]) => m.restoreDocumentation(...a),
}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const actions = await import("../app/(app)/projects/[id]/documentation/actions");
const ID = "01J9ZZZZZZZZZZZZZZZZZZZZZZ";

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset().mockResolvedValue({});
  revalidatePath.mockReset();
});

describe("memory actions", () => {
  it("creates a memory with trimmed title and tags, then refreshes the tab", async () => {
    expect(await actions.createMemoryAction("P1", { title: "  Use pnpm ", body: "b", tags: ["a", " b "] })).toEqual({ ok: true, data: undefined });
    expect(m.createMemory).toHaveBeenCalledWith("P1", { title: "Use pnpm", body: "b", tags: ["a", "b"] });
    expect(revalidatePath).toHaveBeenCalledWith("/projects/P1/documentation", "layout");
  });

  it("rejects an empty title, too many tags and an oversized body before calling the API", async () => {
    const res = await actions.createMemoryAction("P1", { title: " ", body: "x".repeat(64 * 1024 + 1), tags: Array.from({ length: 21 }, (_, i) => `t${i}`) });
    expect(res).toMatchObject({ ok: false, fieldErrors: { title: expect.any(String), body: expect.any(String), tags: expect.any(String) } });
    expect(m.createMemory).not.toHaveBeenCalled();
  });

  it("sends the last-seen updatedAt on update; a stale one is a conflict that still refreshes", async () => {
    m.updateMemory.mockRejectedValue(new ApiError(409, "conflict", "modified", { currentUpdatedAt: "t2" }));
    const res = await actions.updateMemoryAction("P1", ID, { title: "T", body: "", tags: [] }, "t1");
    expect(m.updateMemory).toHaveBeenCalledWith(ID, { title: "T", body: "", tags: [], expectedUpdatedAt: "t1" });
    expect(res).toMatchObject({ ok: false, conflict: true });
    expect(revalidatePath).toHaveBeenCalledWith("/projects/P1/documentation", "layout");
  });

  it("refuses an id that is not a plain reference", async () => {
    expect(await actions.deleteMemoryAction("P1", "../x")).toMatchObject({ ok: false });
    expect(await actions.deleteMemoryAction("a/b", ID)).toMatchObject({ ok: false });
    expect(m.deleteMemory).not.toHaveBeenCalled();
  });
});

describe("document actions", () => {
  it("renames and re-describes with the last-seen updatedAt", async () => {
    await actions.updateDocumentAction("P1", ID, { filename: " b.md ", description: "d" }, "t1");
    expect(m.updateDocument).toHaveBeenCalledWith(ID, { filename: "b.md", description: "d", expectedUpdatedAt: "t1" });
  });

  it("rejects an empty name", async () => {
    expect(await actions.updateDocumentAction("P1", ID, { filename: " ", description: "" }, "t1")).toMatchObject({ ok: false, fieldErrors: { filename: expect.any(String) } });
  });

  it("deletes and restores (memory or document only)", async () => {
    expect(await actions.deleteDocumentAction("P1", ID)).toMatchObject({ ok: true });
    expect(m.deleteDocument).toHaveBeenCalledWith(ID);
    expect(await actions.restoreDocumentationAction("P1", "document", ID)).toMatchObject({ ok: true });
    expect(m.restoreDocumentation).toHaveBeenCalledWith("document", ID);
    expect(await actions.restoreDocumentationAction("P1", "issue" as never, ID)).toMatchObject({ ok: false });
  });
});
