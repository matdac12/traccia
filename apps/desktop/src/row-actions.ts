import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient, ApiFailure, Todo } from "./api-client";
import { titleSegments } from "./title";

/**
 * Done, drop, reopen and undo on the list's rows (docs/desktop-app.md §4). Writes show at once and are put back,
 * with an error toast, when the API refuses them. Rows closed while shown stay, struck through, until the window
 * hides; then they leave the list (they are in the Logbook).
 */

/** How long a toast stays (§4). */
export const TOAST_MS = 5_000;

export const OFFLINE_MESSAGE =
  "Offline: changes are off until Traccia is reachable.";

type ClosedState = "done" | "dropped";

/** The inline "Also mark 2 open Sub-to-dos done?" under a parent the API refused to close alone. */
export type CascadeConfirm = { id: string; count: number; state: ClosedState };

export type Toast = { text: string; canUndo: boolean };

type ToastState = {
  text: string;
  /** A drop's To-dos as they were before it, to reopen on Undo. */
  undo?: Todo[];
};

type RowClient = Pick<ApiClient, "updateTodo">;

export type RowActions = {
  /** The fetched open To-dos with this show's writes applied, closed ones included. */
  todos: Todo[] | null;
  confirm: CascadeConfirm | null;
  toast: Toast | null;
  /** The check: marks an open To-do done, reopens a closed one. */
  toggle: (id: string) => void;
  /** Drops an open To-do. */
  drop: (id: string) => void;
  /** "Yes" in the cascade confirm: retries with `closeSubTodos: true`. */
  confirmCascade: () => void;
  cancelCascade: () => void;
  /** "Undo" in the drop toast, or Ctrl+Z while it shows: reopens what the drop closed. */
  undo: () => void;
  /** A short toast, e.g. a link that would not open. */
  notify: (text: string) => void;
  /** A To-do the composer just added: it shows at once, before the next fetch lists it. */
  added: (todo: Todo) => void;
};

/** The title without its `@KEY` chips, for a toast. */
export function plainTitle(todo: Pick<Todo, "title" | "references">): string {
  return titleSegments(todo.title, todo.references)
    .map((s) => ("text" in s ? s.text : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** The open Sub-to-do count of a 409 `conflict`, or null for any other failure. */
function openSubTodosOf(failure: ApiFailure): number | null {
  if (failure.kind !== "error" || failure.status !== 409) return null;
  const details = failure.details as { openSubTodos?: unknown } | undefined;
  return typeof details?.openSubTodos === "number"
    ? details.openSubTodos
    : null;
}

function errorText(failure: ApiFailure): string {
  return failure.kind === "offline"
    ? OFFLINE_MESSAGE
    : `Not saved. ${failure.message}`;
}

export function useRowActions(
  client: RowClient,
  {
    todos,
    shown,
    offline,
  }: { todos: Todo[] | null; shown: boolean; offline: boolean },
): RowActions {
  /** This show's writes, by To-do id: what the row shows instead of the fetched To-do. */
  const [overrides, setOverrides] = useState<ReadonlyMap<string, Todo>>(
    () => new Map(),
  );
  /** The rows closed during the last show, left out of the list that was fetched before it hid. */
  const [gone, setGone] = useState<{
    from: Todo[] | null;
    ids: ReadonlySet<string>;
  } | null>(null);
  const [confirm, setConfirm] = useState<CascadeConfirm | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const merged = useMemo(() => {
    if (!todos) return null;
    const left = gone && gone.from === todos ? gone.ids : null;
    const out: Todo[] = [];
    const seen = new Set<string>();
    for (const t of todos) {
      if (left?.has(t.id)) continue;
      seen.add(t.id);
      out.push(overrides.get(t.id) ?? t);
    }
    // Closed this show, so no longer in the open list, or added this show and not fetched yet: they stay until
    // the window hides.
    for (const [id, t] of overrides) if (!seen.has(id)) out.push(t);
    return out;
  }, [todos, overrides, gone]);

  // The latest values, for the async writes.
  const latest = useRef({ merged, overrides, todos, offline });
  latest.current = { merged, overrides, todos, offline };
  /** Bumped on every hide: a write from an earlier show neither rolls back nor lands. */
  const showId = useRef(0);
  /** The last write per To-do: an earlier one's answer doesn't overwrite a later click. */
  const lastWrite = useRef(new Map<string, number>());
  const writes = useRef(0);

  useEffect(() => {
    if (shown) return;
    showId.current += 1;
    const { overrides: current, todos: fetched } = latest.current;
    const closed = [...current.values()]
      .filter((t) => t.state !== "open")
      .map((t) => t.id);
    // Still the same list: the rows left out at an earlier hide stay out too.
    setGone((previous) => {
      const ids = new Set(previous?.from === fetched ? previous.ids : []);
      for (const id of closed) ids.add(id);
      return ids.size > 0 ? { from: fetched, ids } : null;
    });
    setOverrides(new Map());
    setConfirm(null);
    setToast(null);
  }, [shown]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const find = (id: string) => latest.current.merged?.find((t) => t.id === id);

  /** Shows `optimistic` at once and sends the PATCH; on a refusal, puts those rows back. */
  async function write(
    id: string,
    input: Parameters<RowClient["updateTodo"]>[1],
    optimistic: Todo[],
  ) {
    const show = showId.current;
    const mark = ++writes.current;
    lastWrite.current.set(id, mark);
    const before = new Map(
      optimistic.map((t) => [t.id, latest.current.overrides.get(t.id)]),
    );
    if (optimistic.length > 0)
      setOverrides((current) => {
        const next = new Map(current);
        for (const t of optimistic) next.set(t.id, t);
        return next;
      });
    const result = await client.updateTodo(id, input);
    const current =
      show === showId.current && lastWrite.current.get(id) === mark;
    if (current && result.ok) {
      const value = result.value;
      setOverrides((map) => new Map(map).set(value.id, value));
    }
    if (current && !result.ok && before.size > 0)
      setOverrides((map) => {
        const next = new Map(map);
        for (const [key, t] of before)
          if (t) next.set(key, t);
          else next.delete(key);
        return next;
      });
    return { result, current };
  }

  async function close(id: string, state: ClosedState, cascade: boolean) {
    const todo = find(id);
    if (!todo) return;
    if (latest.current.offline) return setToast({ text: OFFLINE_MESSAGE });
    setConfirm(null);
    const openSubs = (latest.current.merged ?? []).filter(
      (t) => t.parentId === id && t.state === "open",
    );
    // With open Sub-to-dos in the list, the API will ask first: nothing to strike yet.
    const asksFirst = !cascade && openSubs.length > 0;
    const closing = asksFirst ? [] : [todo, ...(cascade ? openSubs : [])];
    const closedAt = new Date().toISOString();
    if (state === "dropped" && !asksFirst)
      setToast({ text: `Dropped “${plainTitle(todo)}”`, undo: closing });
    const { result, current } = await write(
      id,
      cascade ? { state, closeSubTodos: true } : { state },
      closing.map((t) => ({ ...t, state, closedAt })),
    );
    if (!current || result.ok) return;
    const count = openSubTodosOf(result.failure);
    if (count !== null) {
      // This drop's own toast goes (nothing was dropped); another row's stays.
      setToast((shown) => (shown?.undo?.[0]?.id === id ? null : shown));
      setConfirm({ id, count, state });
    } else setToast({ text: errorText(result.failure) });
  }

  async function reopen(id: string): Promise<boolean> {
    const todo = find(id);
    if (!todo) return false;
    const { result, current } = await write(id, { state: "open" }, [
      { ...todo, state: "open", closedAt: null },
    ]);
    if (current && !result.ok) setToast({ text: errorText(result.failure) });
    return result.ok;
  }

  return {
    todos: merged,
    confirm,
    toast: toast && { text: toast.text, canUndo: toast.undo !== undefined },
    toggle(id) {
      const todo = find(id);
      if (!todo) return;
      if (todo.state === "open") return void close(id, "done", false);
      if (latest.current.offline) return setToast({ text: OFFLINE_MESSAGE });
      void reopen(id);
    },
    drop(id) {
      if (find(id)?.state === "open") void close(id, "dropped", false);
    },
    confirmCascade() {
      if (confirm) void close(confirm.id, confirm.state, true);
    },
    cancelCascade() {
      setConfirm(null);
    },
    notify(text) {
      setToast({ text });
    },
    added(todo) {
      setOverrides((map) => new Map(map).set(todo.id, todo));
    },
    undo() {
      const dropped = toast?.undo;
      if (!dropped) return;
      if (latest.current.offline) return setToast({ text: OFFLINE_MESSAGE });
      setToast(null);
      // The parent first: a Sub-to-do can't reopen under a dropped parent.
      void (async () => {
        for (const t of dropped) if (!(await reopen(t.id))) return;
      })();
    },
  };
}
