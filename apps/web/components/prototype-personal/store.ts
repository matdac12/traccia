"use client";
// PROTOTYPE (TRC-148): in-memory state for the Personal Space variants. Nothing is persisted.
import { useCallback, useMemo, useState } from "react";
import { iso, seed, type Todo } from "./data";

export function useTodos() {
  const today = useMemo(() => iso(new Date()), []);
  const [todos, setTodos] = useState<Todo[]>(() => seed(today));

  const patch = useCallback((id: string, p: Partial<Todo>) => setTodos((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t))), []);

  const bottom = (ts: Todo[], day: string | null, parentId: string | null) =>
    Math.max(-1, ...ts.filter((t) => t.day === day && t.parentId === parentId).map((t) => t.position)) + 1;

  const close = useCallback(
    (id: string, state: "done" | "dropped") =>
      setTodos((ts) => {
        const openKids = ts.filter((t) => t.parentId === id && t.state === "open");
        if (openKids.length && !window.confirm(`Mark ${openKids.length} open Sub-to-do${openKids.length > 1 ? "s" : ""} ${state} too?`)) return ts;
        return ts.map((t) => (t.id === id || (t.parentId === id && t.state === "open") ? { ...t, state, closedOn: today } : t));
      }),
    [today],
  );

  const reopen = useCallback((id: string) => patch(id, { state: "open", closedOn: undefined }), [patch]);

  /** Move to a Planned day, or to Anytime (null), which removes the Reminder after a warning. */
  const move = useCallback(
    (id: string, day: string | null) =>
      setTodos((ts) => {
        const t = ts.find((x) => x.id === id);
        if (!t || t.day === day) return ts;
        if (day === null && t.time && !window.confirm(`Moving to Anytime removes the ${t.time} Reminder.`)) return ts;
        const rearm = t.time && day ? { reminder: "pending" as const } : {};
        return ts.map((x) =>
          x.id === id ? { ...x, day, position: bottom(ts, day, x.parentId), ...(day === null ? { time: null, reminder: null } : rearm) } : x,
        );
      }),
    [],
  );

  const setTime = useCallback(
    (id: string, time: string | null) =>
      setTodos((ts) => ts.map((t) => (t.id === id ? { ...t, time, reminder: time ? "pending" : null, day: t.day ?? (time ? today : null) } : t))),
    [today],
  );

  /** Reorder: `ids` is the new order of one bucket. */
  const reorder = useCallback(
    (ids: string[]) => setTodos((ts) => ts.map((t) => (ids.includes(t.id) ? { ...t, position: ids.indexOf(t.id) } : t))),
    [],
  );

  const add = useCallback(
    (p: { title: string; day: string | null; time: string | null; parentId?: string | null }) =>
      setTodos((ts) => [
        ...ts,
        {
          id: `n${Date.now()}`,
          title: p.title,
          day: p.day,
          time: p.time,
          reminder: p.time ? "pending" : null,
          state: "open",
          parentId: p.parentId ?? null,
          position: bottom(ts, p.day, p.parentId ?? null),
          source: "dashboard",
        },
      ]),
    [],
  );

  const remove = useCallback((id: string) => setTodos((ts) => ts.filter((t) => t.id !== id && t.parentId !== id)), []);

  return { today, todos, patch, close, reopen, move, setTime, reorder, add, remove };
}

export type TodoStore = ReturnType<typeof useTodos>;

export const byPosition = (a: Todo, b: Todo) => a.position - b.position;
