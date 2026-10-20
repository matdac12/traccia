"use client";
import type { Todo } from "@traccia/shared";
import { createContext, useContext, useSyncExternalStore } from "react";

/** What the page knows about a To-do besides the To-do: the state its strike draws, and the last refused write. */
export type TodoStatus = { previews: Readonly<Record<string, Todo["state"]>>; errors: Readonly<Record<string, string>> };

/**
 * A store the rows read one To-do at a time, so a strike starting or ending, or an error showing, renders only the row
 * it is about. A context holding the whole maps would render every row (and its memoised body) each time.
 */
export type TodoStatusStore = { get: () => TodoStatus; set: (next: TodoStatus) => void; subscribe: (listener: () => void) => () => void };

export function createTodoStatusStore(): TodoStatusStore {
  let status: TodoStatus = { previews: {}, errors: {} };
  const listeners = new Set<() => void>();
  return {
    get: () => status,
    set(next) {
      status = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

const TodoStatusContext = createContext<TodoStatusStore>(createTodoStatusStore());
export const TodoStatusProvider = TodoStatusContext;

/** The state the To-do shows while its strike draws, before the write that closes (or reopens) it moves it. */
export function usePreview(id: string): Todo["state"] | undefined {
  const store = useContext(TodoStatusContext);
  return useSyncExternalStore(store.subscribe, () => store.get().previews[id], () => undefined);
}

/** The last refused write on this To-do, shown under its row. */
export function useTodoError(id: string): string | undefined {
  const store = useContext(TodoStatusContext);
  return useSyncExternalStore(store.subscribe, () => store.get().errors[id], () => undefined);
}
