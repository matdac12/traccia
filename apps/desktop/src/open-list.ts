import { useEffect, useState } from "react";
import type { ApiClient, ApiFailure, Project, Todo } from "./api-client";

/** How often the list re-fetches while shown (docs/desktop-app.md §6). */
export const REFRESH_MS = 30_000;

/** Why the list on screen may not be the current one. */
export type ListProblem =
  /** Traccia can't be reached: the last list stays, read-only. */
  | { kind: "offline" }
  /** 401 or 403. */
  | { kind: "refused"; message: string }
  | { kind: "error"; message: string };

export type OpenList = {
  /** The last fetched open To-dos; null until the first fetch succeeds. */
  todos: Todo[] | null;
  /** The To-dos done today, for the shelf, fetched together with `todos`. */
  doneToday: Todo[];
  /** The live Projects, fetched once per show; the last ones if that fails. */
  projects: Project[];
  /** When `todos` was fetched. */
  fetchedAt: Date | null;
  /** Cleared by the next successful fetch. */
  problem: ListProblem | null;
};

type ListClient = Pick<
  ApiClient,
  "listOpenTodos" | "listDoneToday" | "listProjects"
>;

const EMPTY: OpenList = {
  todos: null,
  doneToday: [],
  projects: [],
  fetchedAt: null,
  problem: null,
};

/** Offline and a refused Token have their own lines; anything else (an API error, an unreadable answer, no Settings) shows its message. */
function problemOf(failure: ApiFailure): ListProblem {
  switch (failure.kind) {
    case "offline":
      return { kind: "offline" };
    case "refused":
      return { kind: "refused", message: failure.message };
    default:
      return { kind: "error", message: failure.message };
  }
}

/**
 * The open To-dos, and the ones done today in `timeZone`, while the window is shown: fetched on every show and every
 * 30 s after, with nothing while hidden. A failed fetch keeps the last list and reports why.
 */
export function useOpenList(
  client: ListClient,
  shown: boolean,
  timeZone: string,
): OpenList {
  const [list, setList] = useState<OpenList>(EMPTY);
  useEffect(() => {
    if (!shown) return;
    // Per show: a request left over from the last show neither blocks this one nor lands.
    let live = true;
    let busy = false;

    async function fetchTodos() {
      if (busy) return;
      busy = true;
      try {
        // Both or neither: the rows the shelf takes from the open list land at the same time.
        const [open, done] = await Promise.all([
          client.listOpenTodos(),
          client.listDoneToday(timeZone),
        ]);
        if (!live) return;
        const at = new Date();
        setList((current) => {
          if (open.ok && done.ok)
            return {
              ...current,
              todos: open.value,
              doneToday: done.value,
              fetchedAt: at,
              problem: null,
            };
          const failed = open.ok ? (done.ok ? null : done) : open;
          return {
            ...current,
            problem: failed && problemOf(failed.failure),
          };
        });
      } finally {
        busy = false;
      }
    }

    async function fetchProjects() {
      const result = await client.listProjects();
      if (live && result.ok)
        setList((current) => ({ ...current, projects: result.value }));
    }

    void fetchTodos();
    void fetchProjects();
    const timer = setInterval(() => void fetchTodos(), REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client, shown, timeZone]);

  return list;
}
