"use client";
import type { ProjectOption, Todo } from "@traccia/shared";
import { useEffect, useMemo, useState } from "react";
import { LiveStatus } from "@/components/traccia/live-status";
import { PageHeader } from "@/components/traccia/page-header";
import { byPosition, closedDay, listMenuCounts, listOf, mergeById, type PersonalList, type PersonalSpaceData } from "@/lib/personal/lists";
import { getJson } from "@/lib/polling/fetch-json";
import { usePoll } from "@/lib/polling/use-poll";
import { AnytimeList } from "./anytime-list";
import { DeliveryBanner } from "./delivery-banner";
import { DetailsPanel, type PanelContent } from "./details-panel";
import { ListMenu, projectKeyOf } from "./list-menu";
import { LogbookList, useLogbook } from "./logbook-list";
import { ProjectList } from "./project-list";
import { ProjectOptionsProvider } from "./projects-context";
import { type TodoSelection, TodoSelectionProvider, usePersonalUrl } from "./selection";
import { TodayList } from "./today-list";
import { TodoActionsProvider, useTodoWrites } from "./todo-actions";
import { UpcomingList } from "./upcoming-list";

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

/** The list a link to `id` opens over, once the page holds that To-do (and its parent, for an undated Sub-to-do). */
function linkedList(id: string, todos: Todo[], today: string): PersonalList | null {
  const todo = todos.find((t) => t.id === id);
  return todo ? listOf(todo, today, todo.parentId ? todos.find((t) => t.id === todo.parentId) : null) : null;
}

/**
 * The Personal Space page (docs/personal-space.md §7): the list menu, one list, and the details panel of the To-do the
 * URL selects. The URL holds both (`?list=anytime&todo=<id>`); a link with only `?todo=` opens over the list its To-do
 * belongs to, which is then written into the URL so it stays put while the To-do changes. The server renders the first
 * copy; the live refresh (TRC-52) re-reads it from `GET /api/todos`, "today" and the selected To-do included, so midnight
 * rolls over. The Logbook reads its own pages, only when shown.
 */
export function PersonalSpace({ initial, projects }: { initial: PersonalSpaceData; projects: ProjectOption[] }) {
  // The server's copy is the source of truth; a fresh render replaces whatever the client holds.
  const [seen, setSeen] = useState(initial);
  const [data, setData] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setData(initial);
  }
  const url = usePersonalUrl();
  const { selectedId } = url;
  // Whether the lists alone leave the panel short; then the poll reads the selected To-do too.
  const needsRead = selectedId !== null && lacksSome(panelContent(selectedId, data.todos, undefined));
  const sync = usePoll(async () => {
    const remote = await getJson<PersonalSpaceData>(needsRead ? `/api/todos?todo=${encodeURIComponent(selectedId)}` : "/api/todos");
    // An unchanged answer keeps the same object, so nothing re-renders.
    // A poll that couldn't read the delivery state keeps the last one, so the banner doesn't flicker.
    setData((current) => {
      const next = remote.delivery || !current.delivery ? remote : { ...remote, delivery: current.delivery };
      return JSON.stringify(current) === JSON.stringify(next) ? current : next;
    });
  });
  const { today, timeZone } = data;
  // The read for the selected To-do, once it is the one selected.
  const read = selectedId && data.selected?.id === selectedId ? data.selected : undefined;
  const extra = read?.extra ?? NO_TODOS;
  const logbook = useLogbook(today);
  // One write path for every list and the panel. The freshest copy of a To-do wins: the poll's, then the panel's read,
  // then the Logbook's pages, whose To-dos closed today the poll holds in full.
  const all = useMemo(() => mergeById(data.todos, extra, logbook.items.filter((t) => closedDay(t, timeZone) !== today)), [data.todos, extra, logbook.items, timeZone, today]);
  // What the page shows: the data with the writes still on their way applied.
  const { todos, actions, dialog, notice } = useTodoWrites(all, today, timeZone, projects, logbook);

  // The URL's list, else the one a link's To-do belongs to, else Today.
  const linked = !url.list && selectedId ? linkedList(selectedId, todos, today) : null;
  const list = url.list ?? linked ?? "today";
  const { go } = url;
  useEffect(() => {
    if (linked) go({ list: linked }, "replace");
  }, [linked, go]);
  const selection: TodoSelection = { selectedId, select: (id) => go({ todo: id, list }) };

  // A selection that needs a read: now, rather than at the next poll.
  const { refresh } = sync;
  useEffect(() => {
    if (selectedId && needsRead && !read) refresh();
  }, [selectedId, needsRead, read, refresh]);
  const panel = selectedId ? panelContent(selectedId, todos, read) : null;
  const projectKey = projectKeyOf(list);

  return (
    <ProjectOptionsProvider value={projects}>
      <TodoActionsProvider value={actions}>
        <TodoSelectionProvider value={selection}>
          <PageHeader title="Personal">
            <LiveStatus lastUpdated={sync.lastUpdated} failures={sync.failures} onRefresh={sync.refresh} />
          </PageHeader>
          <DeliveryBanner delivery={data.delivery} />
          {notice}
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <ListMenu active={list} counts={listMenuCounts(todos, today)} onSelect={(next) => go({ list: next })} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[680px] px-4 pb-24 pt-6 md:px-8 md:pt-10">
                {list === "today" ? <TodayList todos={todos} today={today} timeZone={timeZone} /> : null}
                {list === "upcoming" ? <UpcomingList todos={todos} today={today} /> : null}
                {list === "anytime" ? <AnytimeList todos={todos} today={today} /> : null}
                {list === "logbook" ? <LogbookList todos={todos} today={today} timeZone={timeZone} logbook={logbook} /> : null}
                {projectKey ? <ProjectList todos={todos} projectKey={projectKey} /> : null}
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
