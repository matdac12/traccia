"use client";
import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext } from "react";
import { type PersonalList, parseList } from "@/lib/personal/lists";

/** The To-do the details panel shows, and how a row (or the panel) selects another or closes it. */
export type TodoSelection = { selectedId: string | null; select: (id: string | null) => void };

const TodoSelectionContext = createContext<TodoSelection | null>(null);
export const TodoSelectionProvider = TodoSelectionContext;

/** The page's selection, or null outside it (a row rendered on its own can't be selected). */
export const useTodoSelection = () => useContext(TodoSelectionContext);

/** What the URL holds: the list shown and the selected To-do. `undefined` keeps a value as it is, `null` removes it. */
type UrlChange = { list?: PersonalList; todo?: string | null };

/**
 * The Personal Space's URL state (docs/personal-space.md §7.6): `/personal?list=anytime&todo=<id>`. `todo` is the link
 * every Telegram Reminder carries; `list` is the list shown, left out for Today when nothing is selected. `go` pushes a
 * history entry through `history.pushState` (or replaces the current one), which Next's router follows without a
 * server round trip, so back and forward move between lists and selections.
 */
export function usePersonalUrl() {
  const params = useSearchParams();
  const selectedId = params?.get("todo") || null;
  const list = parseList(params?.get("list"));
  const go = useCallback((change: UrlChange, how: "push" | "replace" = "push") => {
    const next = new URLSearchParams(window.location.search);
    const todo = change.todo === undefined ? next.get("todo") : change.todo;
    const shown = change.list ?? parseList(next.get("list"));
    // Any other parameter stays; these two go last, the list first.
    next.delete("list");
    next.delete("todo");
    if (shown && (shown !== "today" || todo)) next.set("list", shown);
    if (todo) next.set("todo", todo);
    // A Project list reads `project:KEY`, not `project%3AKEY`.
    const query = next.toString().replace("list=project%3A", "list=project:");
    const url = query ? `?${query}` : window.location.pathname;
    if (url === (window.location.search || window.location.pathname)) return;
    window.history[how === "push" ? "pushState" : "replaceState"](null, "", url);
  }, []);
  return { selectedId, list, go };
}
