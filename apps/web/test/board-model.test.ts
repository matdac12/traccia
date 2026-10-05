import { describe, expect, it } from "vitest";
import { applyServerIssue, emptyColumns, findCard, moveCard, moveErrorMessage, planMove, type BoardColumn } from "../components/kanban/board-model";
import type { IssueRow } from "../lib/api/schemas";

const card = (n: number, status: IssueRow["status"], projectId = "p1"): IssueRow => ({
  id: `i${n}`, projectId, key: "TRK", number: n, identifier: `TRK-${n}`, title: `Issue ${n}`, description: "", parentId: null, createdAt: "2026-01-01T00:00:00.000Z", status, priority: 0, estimate: null, assignee: null,
  milestoneId: null, createdBy: "you", updatedAt: "2026-01-01T00:00:00.000Z", labels: [],
});
const board = (by: Partial<Record<IssueRow["status"], IssueRow[]>>): BoardColumn[] =>
  emptyColumns().map((c) => ({ ...c, items: by[c.status] ?? [] }));
const ids = (cols: BoardColumn[], status: IssueRow["status"]) => cols.find((c) => c.status === status)!.items.map((i) => i.id);

describe("planMove: neighbour ids for a card already in its dropped place", () => {
  it("between two cards: afterId is the card above", () => {
    const cols = board({ todo: [card(1, "todo"), card(2, "todo"), card(3, "todo")] });
    expect(planMove(moveCard(cols, "i3", "todo", 1), "i3")).toMatchObject({ identifier: "TRK-3", status: "todo", afterId: "TRK-1" });
  });
  it("top of the column: only beforeId, the card below", () => {
    const cols = board({ todo: [card(1, "todo"), card(2, "todo"), card(3, "todo")] });
    expect(planMove(moveCard(cols, "i3", "todo", 0), "i3")).toMatchObject({ identifier: "TRK-3", status: "todo", beforeId: "TRK-1" });
  });
  it("bottom of the column: afterId is the last other card", () => {
    const cols = board({ todo: [card(1, "todo"), card(2, "todo"), card(3, "todo")] });
    expect(planMove(moveCard(cols, "i1", "todo", 2), "i1")).toMatchObject({ identifier: "TRK-1", status: "todo", afterId: "TRK-3" });
  });
  it("empty target column: no neighbours", () => {
    const cols = board({ todo: [card(1, "todo")] });
    const moved = moveCard(cols, "i1", "done", 0);
    expect(ids(moved, "todo")).toEqual([]);
    expect(planMove(moved, "i1")).toMatchObject({ identifier: "TRK-1", status: "done" });
    expect(findCard(moved, "i1")?.status).toBe("done");
  });
  it("cross-column into the middle of another column", () => {
    const cols = board({ todo: [card(1, "todo")], in_progress: [card(2, "in_progress"), card(3, "in_progress")] });
    const moved = moveCard(cols, "i1", "in_progress", 1);
    expect(ids(moved, "in_progress")).toEqual(["i2", "i1", "i3"]);
    expect(planMove(moved, "i1")).toMatchObject({ identifier: "TRK-1", status: "in_progress", afterId: "TRK-2" });
  });
  it("skips neighbours of another project, since a column is (project, status)", () => {
    const cols = board({ todo: [card(1, "todo", "p2"), card(2, "todo", "p1"), card(3, "todo", "p2"), card(4, "todo", "p1")] });
    // i4 dropped between the two p2 cards: the nearest p1 card above is i2.
    expect(planMove(moveCard(cols, "i4", "todo", 2), "i4")).toMatchObject({ identifier: "TRK-4", status: "todo", afterId: "TRK-2" });
    // i2 dropped at the very top: nearest p1 card below is i4.
    expect(planMove(moveCard(cols, "i2", "todo", 0), "i2")).toMatchObject({ identifier: "TRK-2", status: "todo", beforeId: "TRK-4" });
  });
  it("carries the card's updatedAt as expectedUpdatedAt", () => {
    const cols = board({ todo: [{ ...card(1, "todo"), updatedAt: "2026-02-02T00:00:00.000Z" }] });
    expect(planMove(moveCard(cols, "i1", "done", 0), "i1")?.expectedUpdatedAt).toBe("2026-02-02T00:00:00.000Z");
  });
  it("is null for an unknown card", () => expect(planMove(board({}), "nope")).toBeNull());
});

describe("moveCard", () => {
  it("returns the same array when the card does not change place", () => {
    const cols = board({ todo: [card(1, "todo"), card(2, "todo")] });
    expect(moveCard(cols, "i1", "todo", 0)).toBe(cols);
  });
  it("does not mutate the input and updates the card's status on a cross-column move", () => {
    const cols = board({ todo: [card(1, "todo")] });
    const moved = moveCard(cols, "i1", "done", 5);
    expect(ids(cols, "todo")).toEqual(["i1"]);
    expect(moved.find((c) => c.status === "done")!.items[0]!.status).toBe("done");
  });
});

describe("rollback and server answer", () => {
  it("restoring the snapshot undoes an optimistic move", () => {
    const before = board({ todo: [card(1, "todo"), card(2, "todo")] });
    const optimistic = moveCard(before, "i1", "done", 0);
    expect(ids(optimistic, "done")).toEqual(["i1"]);
    expect(ids(before, "todo")).toEqual(["i1", "i2"]);
  });
  it("applies the server's issue to the card in place", () => {
    const cols = board({ done: [card(1, "done"), card(2, "done")] });
    const next = applyServerIssue(cols, { ...card(2, "done"), updatedAt: "2026-02-02T00:00:00.000Z" });
    expect(next[4]!.items.map((i) => i.updatedAt)).toEqual(["2026-01-01T00:00:00.000Z", "2026-02-02T00:00:00.000Z"]);
  });
  it("words a 409 as a conflict that was undone", () => {
    expect(moveErrorMessage("TRK-1", "conflict", "stale")).toMatch(/changed elsewhere.*undone/);
    expect(moveErrorMessage("TRK-1", "validation_error", "bad")).toMatch(/Could not move TRK-1/);
  });
});

describe("planMove with more pages", () => {
  it("sends neither neighbour for the last loaded card when the column has more pages (bottom)", () => {
    const cols = board({ todo: [card(1, "todo"), card(2, "todo")] }).map((c) => (c.status === "todo" ? { ...c, nextCursor: "c" } : c));
    expect(planMove(moveCard(cols, "i1", "todo", 1), "i1")).toMatchObject({ identifier: "TRK-1", status: "todo" });
    expect(planMove(moveCard(cols, "i2", "todo", 0), "i2")).toMatchObject({ identifier: "TRK-2", status: "todo", beforeId: "TRK-1" });
  });
});
