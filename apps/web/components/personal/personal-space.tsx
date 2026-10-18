"use client";
import type { Todo } from "@traccia/shared";
import { useEffect, useMemo, useState } from "react";
import { LiveStatus } from "@/components/traccia/live-status";
import { PageHeader } from "@/components/traccia/page-header";
import { byPosition, listMenuCounts, listOf, type PersonalList, type PersonalSpaceData } from "@/lib/personal/lists";
import type { ProjectOption } from "@/lib/personal/project-autocomplete";
import { getJson } from "@/lib/polling/fetch-json";
import { usePoll } from "@/lib/polling/use-poll";
import { DetailsPanel, type PanelContent } from "./details-panel";
import { ListMenu } from "./list-menu";
import { ListPlaceholder } from "./list-placeholder";
import { ProjectOptionsProvider } from "./projects-context";
import { TodoSelectionProvider, useUrlSelection } from "./selection";
import { TodayList } from "./today-list";
import { TodoActionsProvider, useTodoWrites } from "./todo-actions";

const NO_TODOS: Todo[] = [];

/** What the panel shows for `id`, from the To-dos the page holds (writes on their way applied). */
function panelContent(id: string, todos: Todo[], read: PersonalSpaceData["selected"]): PanelContent {
  const todo = todos.find((t) => t.id === id);
  // Not held: the read for it is on its way, or it came back without it (or a write just deleted it).
  if (!todo) return read ? { kind: "gone" } : { kind: "loading" };
  const parent = todo.parentId ? (todos.find((t) => t.id === todo.parentId) ?? null) : null;
  return { kind: "todo", todo, parent, subTodos: todos.filter((t) => t.parentId === todo.id).sort(byPosition) };
}

/**
 * Whether the panel lacks something only a read of the selected To-do brings: the To-do itself, its parent, or
 * Sub-to-dos its count says exist (closed on an earlier day). Dropped ones, which the count leaves out, come with the
 * next poll.
 */
function lacksSome(content: PanelContent) {
  if (content.kind !== "todo") return content.kind === "loading";
  const { todo, parent, subTodos } = content;
  return (todo.parentId !== null && !parent) || subTodos.filter((t) => t.state !== "dropped").length < (todo.subTodos?.total ?? 0);
}

/**
 * The Personal Space page (docs/personal-space.md §7): the list menu, one list, and the details panel of the To-do the
 * URL selects (`?todo=`). The server renders the first copy; the live refresh (TRC-52) re-reads it from
 * `GET /api/todos`, "today" and the selected To-do included, so midnight rolls over.
 */
export function PersonalSpace({ initial, projects }: { initial: PersonalSpaceData; projects: ProjectOption[] }) {
  // The server's copy is the source of truth; a fresh render replaces whatever the client holds.
  const [seen, setSeen] = useState(initial);
  const [data, setData] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setData(initial);
  }
  const selection = useUrlSelection();
  const { selectedId } = selection;
  // Whether the lists alone leave the panel short; then the poll reads the selected To-do too.
  const needsRead = selectedId !== null && lacksSome(panelContent(selectedId, data.todos, undefined));
  const sync = usePoll(async () => {
    const remote = await getJson<PersonalSpaceData>(needsRead ? `/api/todos?todo=${encodeURIComponent(selectedId)}` : "/api/todos");
    // An unchanged answer keeps the same object, so nothing re-renders.
    setData((current) => (JSON.stringify(current) === JSON.stringify(remote) ? current : remote));
  });
  const { today, timeZone } = data;
  // The read for the selected To-do, once it is the one selected.
  const read = selectedId && data.selected?.id === selectedId ? data.selected : undefined;
  const extra = read?.extra ?? NO_TODOS;
  // One write path for the lists and the panel: the panel's To-dos the lists don't load (closed on an earlier day) join them.
  const all = useMemo(() => (extra.length ? [...data.todos, ...extra] : data.todos), [data.todos, extra]);
  // What the page shows: the data with the writes still on their way applied.
  const { todos, actions, dialog } = useTodoWrites(all, today, timeZone);
  const listed = useMemo(() => {
    const only = new Set(extra.map((t) => t.id));
    return only.size ? todos.filter((t) => !only.has(t.id)) : todos;
  }, [todos, extra]);

  // A link opens over the list its To-do belongs to.
  const [list, setList] = useState<PersonalList>(() => {
    const linked = initial.selected && [...initial.todos, ...initial.selected.extra].find((t) => t.id === initial.selected?.id);
    return linked ? listOf(linked, initial.today) : "today";
  });

  // A selection that needs a read: now, rather than at the next poll.
  const { refresh } = sync;
  useEffect(() => {
    if (selectedId && needsRead && !read) refresh();
  }, [selectedId, needsRead, read, refresh]);
  const panel = selectedId ? panelContent(selectedId, todos, read) : null;

  return (
    <ProjectOptionsProvider value={projects}>
      <TodoActionsProvider value={actions}>
        <TodoSelectionProvider value={selection}>
          <PageHeader title="Personal">
            <LiveStatus lastUpdated={sync.lastUpdated} failures={sync.failures} onRefresh={sync.refresh} />
          </PageHeader>
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <ListMenu active={list} counts={listMenuCounts(listed, today)} onSelect={setList} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[680px] px-4 pb-24 pt-6 md:px-8 md:pt-10">
                {list === "today" ? <TodayList todos={listed} today={today} /> : <ListPlaceholder list={list} />}
              </div>
            </div>
            {panel ? <DetailsPanel content={panel} onClose={() => selection.select(null)} /> : null}
          </div>
          {dialog}
        </TodoSelectionProvider>
      </TodoActionsProvider>
    </ProjectOptionsProvider>
  );
}
