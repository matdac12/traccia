import type { Todo } from "@traccia/shared";
import { describe, expect, it } from "vitest";
import { anytimeList, listMenuCounts, listOf, logbookList, mergeById, parseList, projectTodos, todayList, upcomingList } from "../lib/personal/lists";

const TODAY = "2026-10-17";
const ZONE = "Europe/Rome";

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
    const list = todayList([late2, late1, late0, b, a, c, done, dropped, tomorrow, anytime], TODAY, ZONE);
    expect(ids(list.overdue)).toEqual([late2.id, late0.id, late1.id]);
    expect(ids(list.today)).toEqual([a.id, c.id, b.id]);
    // Closed in the order they were closed.
    expect(ids(list.closed)).toEqual([dropped.id, done.id]);
  });

  it("shows a dated Sub-to-do as its own row in a second block, but not an undated one", () => {
    const parent = todo({ day: null });
    const dated = todo({ parentId: parent.id });
    const undated = todo({ parentId: parent.id, day: null });
    const undatedDone = todo({ parentId: parent.id, day: null, state: "done", closedAt: "2026-10-17T09:00:00Z" });
    const list = todayList([parent, dated, undated, undatedDone], TODAY, ZONE);
    expect(list.today).toEqual([]);
    expect(ids(list.subTodos)).toEqual([dated.id]);
    expect(list.closed).toEqual([]);
  });

  it("puts today's Sub-to-dos after the top-level rows, grouped by parent whatever their Positions", () => {
    const p1 = todo({ day: null, position: 1 });
    const p2 = todo({ day: null, position: 2 });
    const top = todo({ position: 900 });
    // Position is per bucket: p2's Sub-to-do has the lowest number of all.
    const s2 = todo({ parentId: p2.id, position: 1 });
    const s1b = todo({ parentId: p1.id, position: 20 });
    const s1a = todo({ parentId: p1.id, position: 10 });
    const list = todayList([s2, s1b, p2, top, s1a, p1], TODAY, ZONE);
    expect(ids(list.today)).toEqual([top.id]);
    expect(ids(list.subTodos)).toEqual([s1a.id, s1b.id, s2.id]);
  });

  it("counts a Sub-to-do's pending Reminder among the Reminders still to come", () => {
    const parent = todo({ day: null });
    const list = todayList([parent, todo({ parentId: parent.id, reminder: reminder("pending") })], TODAY, ZONE);
    expect(list.remindersToCome).toBe(1);
  });

  it("keeps only the To-dos closed today in the Owner timezone, whatever else it is given", () => {
    // 22:30Z on the 16th is already the 17th in Rome; 21:30Z is still the 16th.
    const lateLast = todo({ state: "done", closedAt: "2026-10-16T22:30:00Z" });
    const yesterday = todo({ state: "done", closedAt: "2026-10-16T21:30:00Z" });
    const longAgo = todo({ state: "dropped", day: "2026-10-02", closedAt: "2026-10-02T09:00:00Z" });
    expect(ids(todayList([lateLast, yesterday, longAgo], TODAY, ZONE).closed)).toEqual([lateLast.id]);
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
      ZONE,
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

describe("listOf", () => {
  it("opens Today for today and Overdue, Upcoming for a later day, Anytime without a day, the Logbook once closed", () => {
    expect(listOf(todo(), TODAY)).toBe("today");
    expect(listOf(todo({ day: "2026-10-02" }), TODAY)).toBe("today");
    expect(listOf(todo({ day: "2026-10-18" }), TODAY)).toBe("upcoming");
    // Past the 14 days: Upcoming's "Later".
    expect(listOf(todo({ day: "2027-03-01" }), TODAY)).toBe("upcoming");
    expect(listOf(todo({ day: null }), TODAY)).toBe("anytime");
    expect(listOf(todo({ state: "done", closedAt: "2026-10-17T08:00:00Z" }), TODAY)).toBe("logbook");
    expect(listOf(todo({ day: null, state: "dropped", closedAt: "2026-10-01T08:00:00Z" }), TODAY)).toBe("logbook");
  });

  it("opens an undated Sub-to-do over its parent's list, which shows it", () => {
    const parent = todo({ day: "2026-10-20" });
    const sub = todo({ day: null, parentId: parent.id });
    expect(listOf(sub, TODAY, parent)).toBe("upcoming");
    expect(listOf(sub, TODAY, { ...parent, day: null })).toBe("anytime");
    // Its parent not at hand: Anytime, where undated To-dos live.
    expect(listOf(sub, TODAY)).toBe("anytime");
    // A dated Sub-to-do has its own row.
    expect(listOf(todo({ parentId: parent.id }), TODAY, parent)).toBe("today");
  });
});

describe("upcomingList", () => {
  const days = (groups: { day: string; todos: Todo[] }[]) => groups.map((g) => [g.day, ids(g.todos)]);

  it("has one section per day for the next 14 days, empty ones included, each by Position", () => {
    const b = todo({ day: "2026-10-18", position: 2 });
    const a = todo({ day: "2026-10-18", position: 1 });
    const last = todo({ day: "2026-10-31" });
    const list = upcomingList([b, a, last, todo(), todo({ day: "2026-10-12" }), todo({ day: null })], TODAY);
    expect(list.days.map((g) => g.day)).toEqual(Array.from({ length: 14 }, (_, i) => `2026-10-${String(18 + i).padStart(2, "0")}`));
    expect(days(list.days)[0]).toEqual(["2026-10-18", [a.id, b.id]]);
    expect(days(list.days)[1]).toEqual(["2026-10-19", []]);
    expect(days(list.days)[13]).toEqual(["2026-10-31", [last.id]]);
    expect(list.later).toEqual([]);
  });

  it("puts every open To-do planned after the 14 days in Later, by day, only days that have one", () => {
    const nov = todo({ day: "2026-11-01" });
    const next = todo({ day: "2027-01-05", position: 2 });
    const first = todo({ day: "2027-01-05", position: 1 });
    const list = upcomingList([next, nov, first, todo({ day: "2027-01-06", state: "done", closedAt: "2026-10-17T08:00:00Z" })], TODAY);
    expect(days(list.later)).toEqual([
      ["2026-11-01", [nov.id]],
      ["2027-01-05", [first.id, next.id]],
    ]);
  });

  it("shows open rows only: dated Sub-to-dos yes, undated ones and closed To-dos no", () => {
    const parent = todo({ day: null });
    const dated = todo({ day: "2026-10-18", parentId: parent.id });
    const list = upcomingList([parent, dated, todo({ day: "2026-10-18", state: "dropped", closedAt: "2026-10-17T08:00:00Z" })], TODAY);
    expect(ids(list.days[0]?.todos ?? [])).toEqual([dated.id]);
  });
});

describe("anytimeList", () => {
  it("lists the open top-level To-dos without a day by Position, each with its open Sub-to-dos: undated by Position, then dated by day", () => {
    const second = todo({ day: null, position: 2 });
    const first = todo({ day: null, position: 1 });
    const subB = todo({ day: null, parentId: first.id, position: 2 });
    const subA = todo({ day: null, parentId: first.id, position: 1 });
    const later = todo({ day: "2026-10-25", parentId: first.id, position: 0 });
    const sooner = todo({ day: "2026-10-18", parentId: first.id, position: 5 });
    const doneSub = todo({ day: null, parentId: first.id, state: "done", closedAt: "2026-10-17T08:00:00Z" });
    const list = anytimeList([second, subB, later, first, sooner, subA, doneSub, todo(), todo({ day: null, state: "done", closedAt: "2026-10-17T08:00:00Z" })]);
    expect(list.map((g) => [g.todo.id, ids(g.undated), ids(g.dated)])).toEqual([
      [first.id, [subA.id, subB.id], [sooner.id, later.id]],
      [second.id, [], []],
    ]);
  });
});

describe("projectTodos", () => {
  it("lists the open rows that reference the key, by day with Anytime last, then Position", () => {
    const anytime = todo({ day: null, references: [ref("CRM")] });
    const late = todo({ day: "2026-10-12", references: [ref("CRM")] });
    const todayB = todo({ position: 2, references: [ref("CRM"), ref("TRC")] });
    const todayA = todo({ position: 1, references: [ref("CRM")] });
    const parent = todo({ day: null });
    const list = projectTodos(
      [
        anytime,
        todayB,
        late,
        todayA,
        parent,
        todo({ references: [ref("TRC")] }),
        todo({ day: null, parentId: parent.id, references: [ref("CRM")] }),
        todo({ state: "done", closedAt: "2026-10-17T08:00:00Z", references: [ref("CRM")] }),
      ],
      "CRM",
    );
    expect(ids(list)).toEqual([late.id, todayA.id, todayB.id, anytime.id]);
  });
});

describe("logbookList", () => {
  it("groups closed To-dos by close day in the Owner timezone, newest first, Sub-to-dos included", () => {
    const parent = todo({ day: null });
    const morning = todo({ state: "done", closedAt: "2026-10-17T07:00:00.000Z" });
    const evening = todo({ state: "dropped", closedAt: "2026-10-17T18:00:00.000Z", parentId: parent.id, day: null });
    // 22:30Z on the 15th is the 16th in Rome.
    const lateNight = todo({ state: "done", closedAt: "2026-10-15T22:30:00.000Z" });
    const old = todo({ state: "done", closedAt: "2026-09-30T10:00:00.000Z" });
    const groups = logbookList([old, morning, parent, lateNight, evening, todo()], ZONE, null);
    expect(groups.map((g) => [g.day, ids(g.todos)])).toEqual([
      ["2026-10-17", [evening.id, morning.id]],
      ["2026-10-16", [lateNight.id]],
      ["2026-09-30", [old.id]],
    ]);
  });

  it("shows nothing older than the last loaded page's end, so a gap never looks like an empty day", () => {
    const loadedEnd = todo({ state: "done", closedAt: "2026-10-10T10:00:00.000Z" });
    const sameMoment = todo({ state: "done", closedAt: "2026-10-10T10:00:00.000Z" });
    const older = todo({ state: "done", closedAt: "2026-10-01T10:00:00.000Z" });
    const groups = logbookList([older, sameMoment, loadedEnd], ZONE, { closedAt: loadedEnd.closedAt as string, id: loadedEnd.id });
    // Ties go by id, newest (highest) first, as the API pages them.
    expect(groups.map((g) => ids(g.todos))).toEqual([[sameMoment.id, loadedEnd.id]]);
  });
});

describe("parseList", () => {
  it("reads ?list=: the named lists and project:KEY, nothing else", () => {
    for (const list of ["today", "upcoming", "anytime", "logbook", "project:CRM", "project:TRC2"]) expect(parseList(list)).toBe(list);
    for (const junk of [null, "", "Today", "trash", "project:", "project:X", "project:TOOLONGKEY", "project:A-B", "project:crm", "project:1AB"]) expect(parseList(junk)).toBeNull();
  });
});

describe("mergeById", () => {
  it("keeps the first copy of each To-do, from the earliest list that has it", () => {
    const a = todo();
    const b = todo();
    const staleA = { ...a, title: "old" };
    expect(mergeById([a], [staleA, b], [b])).toEqual([a, b]);
  });
});
