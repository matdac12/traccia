import type { Todo, UpdateTodoInput } from "@traccia/shared";
import { isMomentPast, type OwnerNow } from "./days";
import { byPosition } from "./lists";

/** What a write changes: a `PATCH /v1/todos/:id` body without `expectedUpdatedAt`, which the write adds itself. */
export type TodoPatch = Omit<UpdateTodoInput, "expectedUpdatedAt">;

/** Whether a patch closes the To-do (done or dropped). */
export const isClosing = (patch: TodoPatch): patch is TodoPatch & { state: "done" | "dropped" } => patch.state === "done" || patch.state === "dropped";

/** Where a position move puts a To-do in its bucket: right above `beforeId`, or right below `afterId`. */
export type TodoMove = { beforeId: string } | { afterId: string };

/** The To-do a move puts it next to. */
export const neighbourOf = (move: TodoMove) => ("afterId" in move ? move.afterId : move.beforeId);

/**
 * A write the page shows before the API confirms it. `at` stands in for `closedAt`; `now` (Owner timezone) dates a
 * Reminder.
 */
export type TodoChange =
  | { type: "update"; id: string; patch: TodoPatch; at: string; now: OwnerNow }
  | ({ type: "move"; id: string } & TodoMove)
  | { type: "delete"; id: string };

/** A To-do's bucket, the scope of its Position: one Planned day (or Anytime) under one parent (or the top level). */
export const bucketOf = (t: Pick<Todo, "day" | "parentId">) => `${t.day ?? "anytime"}/${t.parentId ?? "top"}`;

/** Gap the API leaves past the end of a bucket (docs/rest-todos.md "Manual order"). */
const POSITION_STEP = 1024;

/**
 * Where a drag dropped `activeId`: over `overId`, among `rows` in the order the list shows them. Only rows of its own
 * bucket count, so a row of another bucket in between is skipped and a drop on one is refused (null), as is a drop
 * that moves nothing. The answer names the row now above it, or the one below when it went to the top.
 */
export function dropMove(rows: Todo[], activeId: string, overId: string): TodoMove | null {
  const active = rows.find((t) => t.id === activeId);
  if (!active || activeId === overId) return null;
  const bucket = rows.filter((t) => bucketOf(t) === bucketOf(active)).map((t) => t.id);
  const to = bucket.indexOf(overId);
  if (to === -1) return null;
  const moved = bucket.filter((id) => id !== activeId);
  moved.splice(to, 0, activeId);
  return to > 0 ? { afterId: moved[to - 1] as string } : { beforeId: moved[1] as string };
}

/** The Position a move gives, as the API computes it: the midpoint of the new neighbours, or a step past the end. */
function movedPosition(todos: Todo[], target: Todo, move: TodoMove): number {
  const bucket = todos.filter((t) => t.id !== target.id && bucketOf(t) === bucketOf(target)).sort(byPosition);
  const at = bucket.findIndex((t) => t.id === neighbourOf(move));
  if (at === -1) return target.position;
  const [above, below] = "afterId" in move ? [bucket[at], bucket[at + 1]] : [bucket[at - 1], bucket[at]];
  if (above && below) return (above.position + below.position) / 2;
  return above ? above.position + POSITION_STEP : (below as Todo).position - POSITION_STEP;
}

type Reminder = NonNullable<Todo["reminder"]>;
const armed = (time: string): Reminder => ({ time, status: "pending", failure: null, sentAt: null });

/** What a Sub-to-do adds to its parent's `n/m`: dropped ones are out of both. */
const counted = (state: Todo["state"]) => ({ done: state === "done" ? 1 : 0, total: state === "dropped" ? 0 : 1 });

/**
 * The API's update rules (docs/rest-todos.md "Editing", "Reminders"), applied locally: a new day goes to the bottom
 * of its bucket and re-arms the Reminder, Anytime drops it, a `time` on an Anytime To-do dates it today (at the bottom),
 * closing sets `closedAt`, reopening skips a pending Reminder whose moment has passed. The server's copy replaces this
 * one as soon as the write returns.
 */
function patched(todo: Todo, patch: TodoPatch, change: { at: string; now: OwnerNow }, bottom: number): Todo {
  const next = { ...todo };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.details !== undefined) next.details = patch.details || null;
  if (patch.day !== undefined && patch.day !== todo.day) {
    next.day = patch.day;
    next.position = bottom;
    next.reminder = patch.day === null || !todo.reminder ? null : armed(todo.reminder.time);
  }
  if (patch.time !== undefined) {
    next.reminder = patch.time === null ? null : armed(patch.time);
    if (patch.time !== null && next.day === null) {
      next.day = change.now.today;
      next.position = bottom;
    }
  }
  if (patch.state !== undefined && patch.state !== todo.state) {
    next.state = patch.state;
    next.closedAt = patch.state === "open" ? null : change.at;
    // A reopen that also moves the moment re-armed it above instead.
    const reminder = next.reminder;
    if (patch.state === "open" && reminder === todo.reminder && reminder?.status === "pending" && next.day && isMomentPast(next.day, reminder.time, change.now)) {
      next.reminder = { ...reminder, status: "skipped" };
    }
  }
  return next;
}

/** `todos` with one write applied, as the API would apply it. Unknown ids leave the list untouched. */
export function applyTodoChange(todos: Todo[], change: TodoChange): Todo[] {
  const target = todos.find((t) => t.id === change.id);
  if (!target) return todos;

  // The To-dos that change with it (its Sub-to-dos, for a delete or closeSubTodos): their new copy, null when gone.
  if (change.type === "move") {
    const position = movedPosition(todos, target, change);
    return todos.map((t) => (t === target ? { ...t, position } : t));
  }

  const after = new Map<string, Todo | null>();
  if (change.type === "delete") {
    for (const t of todos) if (t.id === target.id || t.parentId === target.id) after.set(t.id, null);
  } else {
    const { patch } = change;
    const bottom = Math.max(0, ...todos.map((t) => t.position)) + 1;
    after.set(target.id, patched(target, patch, change, bottom));
    if (patch.closeSubTodos && isClosing(patch)) {
      for (const t of todos) if (t.parentId === target.id && t.state === "open") after.set(t.id, patched(t, { state: patch.state }, change, bottom));
    }
  }

  // Each changed Sub-to-do moves its parent's n/m by the difference it makes.
  const counts = new Map<string, { done: number; total: number }>();
  for (const old of todos) {
    if (!after.has(old.id) || !old.parentId || after.get(old.parentId) === null) continue;
    const next = after.get(old.id);
    const was = counted(old.state);
    const now = next ? counted(next.state) : { done: 0, total: 0 };
    const c = counts.get(old.parentId) ?? { done: 0, total: 0 };
    counts.set(old.parentId, { done: c.done + now.done - was.done, total: c.total + now.total - was.total });
  }

  const out: Todo[] = [];
  for (const t of todos) {
    let next = after.has(t.id) ? after.get(t.id) : t;
    if (!next) continue;
    const delta = counts.get(t.id);
    if (delta && next.subTodos) next = { ...next, subTodos: { done: next.subTodos.done + delta.done, total: next.subTodos.total + delta.total } };
    out.push(next);
  }
  return out;
}
