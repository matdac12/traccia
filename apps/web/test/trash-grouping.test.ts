import { describe, expect, it } from "vitest";
import type { TrashItem } from "../lib/api/schemas";
import { groupedRows, togetherText } from "../components/trash/trash-model";

const item = (type: TrashItem["type"], id: string, deletedBatch: string | null): TrashItem =>
  ({ type, id, label: id, deletedBatch, deletedAt: "2026-01-01T00:00:00Z", deletedBy: "you", issueId: "A-1", projectId: "p", projectName: "P", parentId: null }) as TrashItem;

describe("groupedRows", () => {
  const issue = item("issue", "i1", "b1");
  const comment = item("comment", "c1", "b1");
  const attachment = item("attachment", "a1", "b1");
  const lone = item("comment", "c2", "b2");
  const all = [issue, comment, attachment, lone];

  it("folds an issue's comment and attachment into the issue row", () => {
    expect(groupedRows(all, all).map((t) => t.id)).toEqual(["i1", "c2"]);
  });
  it("keeps a comment deleted on its own", () => {
    expect(groupedRows([lone], all)).toEqual([lone]);
  });
  it("describes the folded children", () => {
    expect(togetherText([comment, attachment])).toBe("with 1 comment and 1 attachment");
  });
});
