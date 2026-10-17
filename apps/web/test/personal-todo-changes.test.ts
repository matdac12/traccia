import type { Todo } from "@traccia/shared";
import { describe, expect, it } from "vitest";
import { applyTodoChange } from "../lib/personal/todo-changes";

const TODAY = "2026-10-17";
const AT = "2026-10-17T13:00:00.000Z";

let n = 0;
function todo(over: Partial<Todo> = {}): Todo {
  n++;
  return {
    id: `t${n}`,
    title: `To-do ${n}`,
    references: [],
    day: TODAY,
    reminder: null,
    state: "open",
    closedAt: null,
    parentId: null,
    subTodos: { done: 0, total: 0 },
    position: n * 1024,
    details: null,
    source: "dashboard",
    url: "",
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...over,
  };
}
const sent = { time: "09:00", status: "sent" as const, failure: null, sentAt: "2026-10-16T07:00:00Z" };
const NOW = { today: TODAY, time: "15:00" };
const update = (id: string, patch: object) => ({ type: "update" as const, id, patch, at: AT, now: NOW });
const byId = (todos: Todo[], id: string) => todos.find((t) => t.id === id);

describe("applyTodoChange: the optimistic copy of a write", () => {
  it("moves a To-do to the bottom of its new day and re-arms its Reminder there", () => {
    const moved = todo({ day: "2026-10-16", reminder: sent });
    const there = todo({ day: "2026-10-20", position: 99_999 });
    const out = applyTodoChange([moved, there], update(moved.id, { day: "2026-10-20" }));
    const t = byId(out, moved.id)!;
    expect(t.day).toBe("2026-10-20");
    expect(t.position).toBeGreaterThan(99_999);
    expect(t.reminder).toEqual({ time: "09:00", status: "pending", failure: null, sentAt: null });
  });

  it("drops the Reminder when the To-do goes to Anytime", () => {
    const t = todo({ reminder: sent });
    expect(byId(applyTodoChange([t], update(t.id, { day: null })), t.id)).toMatchObject({ day: null, reminder: null });
  });

  it("sets a pending Reminder, dating an Anytime To-do today at the bottom, and removes one with null", () => {
    const anytime = todo({ day: null });
    const today = todo({ position: 99_999 });
    const dated = byId(applyTodoChange([anytime, today], update(anytime.id, { time: "18:00" })), anytime.id);
    expect(dated).toMatchObject({ day: TODAY, reminder: { time: "18:00", status: "pending", failure: null, sentAt: null } });
    expect(dated?.position).toBeGreaterThan(99_999);
    const withOne = todo({ reminder: sent });
    expect(byId(applyTodoChange([withOne], update(withOne.id, { time: null })), withOne.id)?.reminder).toBeNull();
  });

  it("closes and reopens, and keeps the parent's n/m in step", () => {
    const parent = todo({ subTodos: { done: 0, total: 2 } });
    const kid = todo({ parentId: parent.id, subTodos: null });
    const done = applyTodoChange([parent, kid], update(kid.id, { state: "done" }));
    expect(byId(done, kid.id)).toMatchObject({ state: "done", closedAt: AT });
    expect(byId(done, parent.id)?.subTodos).toEqual({ done: 1, total: 2 });
    // Dropped ones leave the total.
    const dropped = applyTodoChange(done, update(kid.id, { state: "dropped" }));
    expect(byId(dropped, parent.id)?.subTodos).toEqual({ done: 0, total: 1 });
    const reopened = applyTodoChange(dropped, update(kid.id, { state: "open" }));
    expect(byId(reopened, kid.id)).toMatchObject({ state: "open", closedAt: null });
    expect(byId(reopened, parent.id)?.subTodos).toEqual({ done: 0, total: 2 });
  });

  it("skips a pending Reminder whose moment passed when the To-do is reopened, unless the reopen moves it", () => {
    const missed = { time: "09:00", status: "pending" as const, failure: null, sentAt: null };
    const t = todo({ state: "done", closedAt: "2026-10-17T06:00:00Z", reminder: missed });
    expect(byId(applyTodoChange([t], update(t.id, { state: "open" })), t.id)?.reminder?.status).toBe("skipped");
    const later = todo({ state: "done", closedAt: "2026-10-17T06:00:00Z", reminder: { ...missed, time: "18:00" } });
    expect(byId(applyTodoChange([later], update(later.id, { state: "open" })), later.id)?.reminder?.status).toBe("pending");
    const moved = byId(applyTodoChange([t], update(t.id, { state: "open", day: "2026-10-18" })), t.id);
    expect(moved?.reminder).toMatchObject({ time: "09:00", status: "pending" });
  });

  it("with closeSubTodos, closes the open Sub-to-dos the same way and leaves closed ones alone", () => {
    const parent = todo({ subTodos: { done: 1, total: 3 } });
    const open1 = todo({ parentId: parent.id, subTodos: null });
    const open2 = todo({ parentId: parent.id, day: null, subTodos: null });
    const earlier = todo({ parentId: parent.id, state: "done", closedAt: "2026-10-16T10:00:00Z", subTodos: null });
    const out = applyTodoChange([parent, open1, open2, earlier], update(parent.id, { state: "dropped", closeSubTodos: true }));
    expect(out.map((t) => t.state)).toEqual(["dropped", "dropped", "dropped", "done"]);
    expect(byId(out, earlier.id)?.closedAt).toBe("2026-10-16T10:00:00Z");
    expect(byId(out, parent.id)?.subTodos).toEqual({ done: 1, total: 1 });
  });

  it("deletes a To-do with its Sub-to-dos, and a Sub-to-do leaves its parent's count", () => {
    const parent = todo({ subTodos: { done: 1, total: 2 } });
    const kid = todo({ parentId: parent.id, subTodos: null });
    const other = todo();
    expect(applyTodoChange([parent, kid, other], { type: "delete", id: parent.id }).map((t) => t.id)).toEqual([other.id]);
    const out = applyTodoChange([parent, kid, other], { type: "delete", id: kid.id });
    expect(out.map((t) => t.id)).toEqual([parent.id, other.id]);
    expect(byId(out, parent.id)?.subTodos).toEqual({ done: 1, total: 1 });
  });

  it("leaves the list as it is when the To-do is no longer there", () => {
    const list = [todo()];
    expect(applyTodoChange(list, update("gone", { state: "done" }))).toBe(list);
  });
});
