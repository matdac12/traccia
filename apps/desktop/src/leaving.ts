import { useEffect, useRef, useState } from "react";
import type { Todo } from "./api-client";

/**
 * A row closed while the window is shown doesn't jump away (docs/desktop-app.md §3.4): the line draws through its
 * title, and after a beat the row folds to nothing, so the rows below slide up. Then a done row is on the shelf and a
 * dropped one is gone.
 */

/** From the close until the fold starts: the 300 ms line, then a beat to see it. */
export const STRIKE_MS = 600;
/** The fold itself (the row's height to nothing). */
export const FOLD_MS = 300;

export type LeavePhase = "strike" | "fold";
export type Leaving = ReadonlyMap<string, LeavePhase>;

type Timers = Map<string, ReturnType<typeof setTimeout>[]>;

const NONE: Leaving = new Map();

/** `current` after `todos` went from `before`: rows that just closed start leaving, reopened ones stop. */
function nextLeaving(
  current: Leaving,
  before: Todo[] | null,
  todos: Todo[] | null,
): Leaving {
  const was = new Map((before ?? []).map((t) => [t.id, t.state]));
  let next: Map<string, LeavePhase> | null = null;
  for (const t of todos ?? []) {
    const state = was.get(t.id);
    const closed = state === "open" && t.state !== "open";
    const reopened =
      state !== undefined && state !== "open" && t.state === "open";
    if (!closed && !(reopened && current.has(t.id))) continue;
    next ??= new Map(current);
    if (closed) next.set(t.id, "strike");
    else next.delete(t.id);
  }
  return next ?? current;
}

/**
 * The rows leaving their place, by id. A row starts leaving when it goes from open to closed in `todos` while shown;
 * reopening it stops that, and so does a hide. A To-do first seen closed (today's done ones, fetched) never leaves.
 */
export function useLeaving(todos: Todo[] | null, shown: boolean): Leaving {
  const [leaving, setLeaving] = useState<Leaving>(NONE);
  const [seen, setSeen] = useState(todos);
  // Worked out while rendering, not in an effect: a row that just closed must not show on the shelf for a frame.
  if (todos !== seen) {
    setSeen(todos);
    if (shown) setLeaving(nextLeaving(leaving, seen, todos));
  }

  // Each leaving row folds after a beat, then goes; a row that stopped leaving keeps no timers.
  const timers = useRef<Timers>(new Map());
  useEffect(() => {
    const running = timers.current;
    for (const [id, pending] of running)
      if (!leaving.has(id)) {
        for (const timer of pending) clearTimeout(timer);
        running.delete(id);
      }
    const set = (id: string, phase: LeavePhase | null) =>
      setLeaving((current) => {
        const next = new Map(current);
        if (phase === null) next.delete(id);
        else next.set(id, phase);
        return next;
      });
    for (const [id, phase] of leaving)
      if (phase === "strike" && !running.has(id))
        running.set(id, [
          setTimeout(() => set(id, "fold"), STRIKE_MS),
          setTimeout(() => set(id, null), STRIKE_MS + FOLD_MS),
        ]);
  }, [leaving]);

  useEffect(() => {
    if (!shown) setLeaving(NONE);
  }, [shown]);

  useEffect(() => {
    const running = timers.current;
    return () => {
      for (const pending of running.values())
        for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  return leaving;
}
