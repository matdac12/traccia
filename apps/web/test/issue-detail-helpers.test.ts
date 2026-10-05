import { describe, expect, it } from "vitest";
import { activitySchema, commentSchema } from "../lib/api/schemas";
import { describeActivity } from "../lib/issue-detail/activity";
import { buildThreads } from "../lib/issue-detail/comments";

const c = (id: string, parentId: string | null, at: string, extra: object = {}) => ({
  id,
  issueId: "i",
  parentId,
  body: id,
  actor: "you" as const,
  createdAt: at,
  updatedAt: at,
  ...extra,
});

describe("buildThreads", () => {
  it("nests replies under their top-level comment, oldest first", () => {
    const threads = buildThreads([c("r2", "a", "2026-01-01T00:03"), c("b", null, "2026-01-01T00:02"), c("a", null, "2026-01-01T00:01"), c("r1", "a", "2026-01-01T00:02")]);
    expect(threads.map((t) => t.id)).toEqual(["a", "b"]);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(threads[1]!.replies).toEqual([]);
  });
  it("accepts the API's nested shape", () => {
    const threads = buildThreads([{ ...c("a", null, "2026-01-01T00:01"), replies: [c("r", "a", "2026-01-01T00:02")] }]);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(["r"]);
  });
  it("keeps a reply whose parent is missing as a top-level comment", () => {
    const threads = buildThreads([c("r", "gone", "2026-01-01T00:01")]);
    expect(threads.map((t) => [t.id, t.parentId])).toEqual([["r", null]]);
  });
  it("flattens deeper nesting into the top-level thread (one level of replies)", () => {
    const threads = buildThreads([c("a", null, "2026-01-01T00:01"), c("r", "a", "2026-01-01T00:02"), c("rr", "r", "2026-01-01T00:03")]);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(["r", "rr"]);
  });
  it("parses the API comment shape, defaulting replies", () => {
    expect(commentSchema.parse(c("a", null, "t")).replies).toEqual([]);
  });
});

describe("activity", () => {
  it("parses JSON-string data and tolerates garbage", () => {
    const base = { id: "1", issueId: "i", actor: "you", type: "status_changed", createdAt: "t" };
    expect(activitySchema.parse({ ...base, data: '{"from":"todo","to":"done"}' }).data).toEqual({ from: "todo", to: "done" });
    expect(activitySchema.parse({ ...base, data: "not json" }).data).toEqual({});
    expect(activitySchema.parse({ ...base, data: { a: 1 } }).data).toEqual({ a: 1 });
  });
  it("describes the common rows", () => {
    expect(describeActivity({ type: "status_changed", data: { from: "todo", to: "in_progress" } })).toBe("changed status from Todo to In Progress");
    expect(describeActivity({ type: "priority_changed", data: { from: 0, to: 1 } })).toBe("changed priority from No priority to Urgent");
    expect(describeActivity({ type: "assignee_changed", data: { from: null, to: "agent" } })).toBe("changed assignee from nobody to an agent");
    expect(describeActivity({ type: "blocker_added", data: { blocker: "MAT-1", blocked: "MAT-2" } })).toBe("marked MAT-1 as blocking MAT-2");
    expect(describeActivity({ type: "comment_added", data: { parentId: "x" } })).toBe("replied to a comment");
    expect(describeActivity({ type: "milestone_changed", data: { from: null, to: "m1" } }, { milestone: () => "M1" })).toBe("changed milestone from none to M1");
    expect(describeActivity({ type: "status_changed", data: {} })).toBe("changed status from ? to ?");
  });
});
