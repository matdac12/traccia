import { beforeEach, describe, expect, it, vi } from "vitest";
import { itemHref, pluralize, restoreSummary, summarize, TYPE_LABEL } from "../components/trash/trash-model";
import { restoreResultSchema, TRASH_TYPES, type TrashItem, trashItemSchema } from "../lib/api/schemas";

const request = vi.fn();
vi.mock("../lib/api/client", () => ({ api: () => ({ request }) }));
const { purgeItem } = await import("../lib/api/trash");

const raw = (type: string) => ({
  type,
  id: "x1",
  label: "Something",
  deletedAt: "2026-10-05T10:00:00Z",
  deletedBatch: "b1",
  issueId: null,
  parentId: null,
  projectId: "p1",
  projectName: "P",
  deletedBy: "agent",
});

beforeEach(() => request.mockReset());

describe("memory and document Trash items", () => {
  it.each(["memory", "document"])("parses a trashed %s", (type) => {
    expect(trashItemSchema.safeParse(raw(type)).success).toBe(true);
  });
  it("offers them as filter types with labels", () => {
    expect(TRASH_TYPES).toEqual(expect.arrayContaining(["memory", "document"]));
    expect(TYPE_LABEL.memory).toBe("Memory");
    expect(TYPE_LABEL.document).toBe("Document");
  });
  it("purges them through their own REST routes", async () => {
    request.mockResolvedValue({ purged: true });
    await purgeItem("memory", "m 1");
    await purgeItem("document", "d1");
    expect(request.mock.calls.map((c) => c[0])).toEqual(["/memories/m%201", "/documents/d1"]);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE", query: { purge: true } });
  });
  it("links a document to its project's Files page, a memory nowhere", () => {
    const doc = raw("document") as TrashItem;
    expect(itemHref(doc)).toBe("/projects/p1/documentation/files");
    expect(itemHref({ ...doc, projectId: null })).toBeNull();
    expect(itemHref(raw("memory") as TrashItem)).toBeNull();
  });
  it("counts them in a restore summary", () => {
    const counts = { projects: 0, milestones: 0, issues: 0, comments: 0, attachments: 0, todos: 0, memories: 2, documents: 1 };
    const result = restoreResultSchema.parse({ type: "project", id: "p1", counts });
    expect(restoreSummary(result)).toBe("Restored 2 memories and 1 document.");
    expect(pluralize("memory", 1)).toBe("1 memory");
    expect(summarize([raw("document") as TrashItem])).toBe("1 document");
  });
});
