import type { Todo } from "@traccia/shared";
import { describe, expect, it } from "vitest";
import { listMenuCounts, todayList } from "../lib/personal/lists";

const TODAY = "2026-10-17";

let n = 0;
function todo(over: Partial<Todo> = {}): Todo {
  n++;
  return {
    id: `t${String(n).padStart(3, "0")}`,
    title: `To-do ${n}`,
    references: [],
    day: TODAY,
    reminder: null,
    state: "open",
    closedAt: null,
    parentId: null,
    subTodos: null,
    position: n * 1024,
    details: null,
    source: "dashboard",
    url: `http://x/personal?todo=t${n}`,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...over,
  };
}
const ids = (todos: { id: string }[]) => todos.map((t) => t.id);
const reminder = (status: "pending" | "sent" | "failed" | "skipped", time = "15:00") => ({ time, status, failure: null, sentAt: null });
const ref = (key: string, projectDeleted = false) => ({ key, projectId: `p_${key}`, projectDeleted });

describe("todayList", () => {
  it("splits Overdue, Today and today's closed To-dos; Today follows Position", () => {
    const late2 = todo({ day: "2026-10-15", position: 1 });
    const late1 = todo({ day: "2026-10-16", position: 1 });
    const late0 = todo({ day: "2026-10-15", position: 2 });
    const b = todo({ position: 2048 });
    const a = todo({ position: 1024 });
    const c = todo({ position: 1536 });
    const done = todo({ state: "done", closedAt: "2026-10-17T08:00:00Z" });
    const dropped = todo({ state: "dropped", day: null, closedAt: "2026-10-17T07:00:00Z" });
    const tomorrow = todo({ day: "2026-10-18" });
    const anytime = todo({ day: null });
    const list = todayList([late2, late1, late0, b, a, c, done, dropped, tomorrow, anytime], TODAY);
    expect(ids(list.overdue)).toEqual([late2.id, late0.id, late1.id]);
    expect(ids(list.today)).toEqual([a.id, c.id, b.id]);
    // Closed in the order they were closed.
    expect(ids(list.closed)).toEqual([dropped.id, done.id]);
  });

  it("shows a dated Sub-to-do as its own row, but not an undated one", () => {
    const parent = todo({ day: null });
    const dated = todo({ parentId: parent.id });
    const undated = todo({ parentId: parent.id, day: null });
    const undatedDone = todo({ parentId: parent.id, day: null, state: "done", closedAt: "2026-10-17T09:00:00Z" });
    const list = todayList([parent, dated, undated, undatedDone], TODAY);
    expect(ids(list.today)).toEqual([dated.id]);
    expect(list.closed).toEqual([]);
  });

  it("counts the Reminders still to come: pending ones on today's open To-dos", () => {
    const list = todayList(
      [
        todo({ reminder: reminder("pending") }),
        todo({ reminder: reminder("pending", "18:30") }),
        todo({ reminder: reminder("sent", "09:00") }),
        todo({ reminder: reminder("failed") }),
        todo({ day: "2026-10-16", reminder: reminder("skipped") }),
        todo({ state: "done", closedAt: "2026-10-17T09:00:00Z", reminder: reminder("pending") }),
      ],
      TODAY,
    );
    expect(list.remindersToCome).toBe(2);
  });
});

describe("listMenuCounts", () => {
  it("counts Today (open today plus Overdue), Anytime (top level) and each Project key the open rows reference", () => {
    const parent = todo({ day: null, title: "Kitchen @HOME", references: [ref("HOME")] });
    const counts = listMenuCounts(
      [
        todo({ day: "2026-10-12" }),
        todo(),
        todo({ references: [ref("CRM")] }),
        todo({ day: "2026-10-20", references: [ref("CRM"), ref("TRC")] }),
        parent,
        // An undated Sub-to-do has no row of its own, so its key doesn't count.
        todo({ day: null, parentId: parent.id, references: [ref("CRM")] }),
        todo({ day: "2026-10-18", parentId: parent.id, references: [ref("HOME")] }),
        todo({ references: [ref("OLD", true)] }),
        todo({ state: "done", closedAt: "2026-10-17T09:00:00Z", references: [ref("PUB")] }),
      ],
      TODAY,
    );
    expect(counts.today).toBe(4);
    expect(counts.anytime).toBe(1);
    // Sorted by key; closed To-dos don't count, a deleted Project's key stays.
    expect(counts.projects).toEqual([
      { key: "CRM", count: 2, projectDeleted: false },
      { key: "HOME", count: 2, projectDeleted: false },
      { key: "OLD", count: 1, projectDeleted: true },
      { key: "TRC", count: 1, projectDeleted: false },
    ]);
  });

  it("counts a To-do once per key even when the key names two Projects", () => {
    const shared = [
      { key: "MAT", projectId: "p1", projectDeleted: false },
      { key: "MAT", projectId: "p2", projectDeleted: false },
    ];
    expect(listMenuCounts([todo({ references: shared })], TODAY).projects).toEqual([{ key: "MAT", count: 1, projectDeleted: false }]);
  });
});
