"use client";
import { useSearchParams } from "next/navigation";
import { createContext, useContext } from "react";

/** The To-do the details panel shows, and how a row (or the panel) selects another or closes it. */
export type TodoSelection = { selectedId: string | null; select: (id: string | null) => void };

const TodoSelectionContext = createContext<TodoSelection | null>(null);
export const TodoSelectionProvider = TodoSelectionContext;

/** The page's selection, or null outside it (a row rendered on its own can't be selected). */
export const useTodoSelection = () => useContext(TodoSelectionContext);

/**
 * The selected To-do lives in the URL, `/personal?todo=<id>` (docs/personal-space.md §7.6), the link every Telegram
 * Reminder carries. Selecting pushes a history entry through `history.pushState`, which Next's router follows without
 * a server round trip, so back and forward move between selections; closing removes the parameter.
 */
export function useUrlSelection(): TodoSelection {
  const selectedId = useSearchParams()?.get("todo") || null;
  const select = (id: string | null) => {
    if (id === selectedId) return;
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("todo", id);
    else params.delete("todo");
    const query = params.toString();
    window.history.pushState(null, "", query ? `?${query}` : window.location.pathname);
  };
  return { selectedId, select };
}
