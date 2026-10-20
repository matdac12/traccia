import { issueKeySchema, type Todo, type TodoDelivery } from "@traccia/shared";
import { addDays, dayInZone } from "./days";

/** The Personal Space lists (docs/personal-space.md §7.3). */
export type PersonalList = "today" | "upcoming" | "anytime" | "logbook" | `project:${string}`;

const NAMED_LISTS = new Set(["today", "upcoming", "anytime", "logbook"]);

/** The list a `?list=` value names: a named list or `project:KEY` (a well-formed Project key), else null. */
export function parseList(value: string | null | undefined): PersonalList | null {
  if (!value) return null;
  if (NAMED_LISTS.has(value)) return value as PersonalList;
  return value.startsWith("project:") && issueKeySchema.safeParse(value.slice("project:".length)).success ? (value as PersonalList) : null;
}

/** One copy of each To-do: the first list that has it wins, so the freshest source goes first. */
export function mergeById(...lists: Todo[][]): Todo[] {
  const seen = new Set<string>();
  const out: Todo[] = [];
  for (const list of lists) {
    for (const t of list) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

/**
 * The list a To-do opens over when a link selects it (docs/personal-space.md §7.6): Today for today and Overdue,
 * Upcoming for a later day (its "Later" included), Anytime, or the Logbook once closed. An undated Sub-to-do has no
 * row of its own, so it opens over its parent's list when the parent is at hand.
 */
export function listOf(todo: Todo, today: string, parent?: Todo | null): PersonalList {
  if (todo.state !== "open") return "logbook";
  if (todo.day === null) return todo.parentId && parent ? listOf(parent, today) : "anytime";
  return todo.day <= today ? "today" : "upcoming";
}

/**
 * The To-do the URL selects (`/personal?todo=<id>`), read for the details panel: the To-dos it shows that the lists
 * don't load (it, its Sub-to-dos or its parent, when closed on an earlier day). A To-do that no longer exists is in
 * neither.
 */
export type SelectedTodo = { id: string; extra: Todo[] };

/**
 * The Personal Space page's data: today in the Owner timezone (and the zone), the open To-dos and those closed today,
 * plus the selected To-do when the URL names one and the Reminder delivery state (absent when the API couldn't say).
 */
export type PersonalSpaceData = { today: string; timeZone: string; todos: Todo[]; selected?: SelectedTodo; delivery?: TodoDelivery };

/** One page of the Logbook as the API sends it, newest first; `nextCursor` reads the next (older) one. */
export type LogbookPage = { items: Todo[]; nextCursor: string | null };

/** A To-do that gets its own row in the day lists: top level, or a Sub-to-do with its own Planned day. */
const ownRow = (t: Todo) => t.parentId === null || t.day !== null;

export const byPosition = (a: Todo, b: Todo) => a.position - b.position || a.id.localeCompare(b.id);
const byDayThenPosition = (a: Todo, b: Todo) => (a.day ?? "").localeCompare(b.day ?? "") || byPosition(a, b);
const byClosedAt = (a: Todo, b: Todo) => (a.closedAt ?? "").localeCompare(b.closedAt ?? "") || a.id.localeCompare(b.id);

/** Open with a Planned day that has passed: it shows in Today until it is moved or closed. */
export const isOverdue = (t: Pick<Todo, "state" | "day">, today: string) => t.state === "open" && t.day !== null && t.day < today;

/** Whether a Reminder is still to come: only a pending one is lost by moving the To-do to Anytime (§7.5). */
export const hasPendingReminder = (t: Pick<Todo, "reminder">) => t.reminder?.status === "pending";

/** An open To-do the Today list shows: Overdue, or planned for today. */
const isOnToday = (t: Todo, today: string) => t.state === "open" && ownRow(t) && t.day !== null && t.day <= today;

/** The day a closed To-do was closed on, in the Owner timezone (the Logbook's day); null while open. */
export const closedDay = (t: Pick<Todo, "closedAt">, timeZone: string) => (t.closedAt ? dayInZone(t.closedAt, timeZone) : null);

/**
 * The Today list (docs/personal-space.md §7.3): Overdue (oldest day first), today's open To-dos by Position, then the
 * done and dropped ones closed today (in `timeZone`), in the order they were closed. Whatever else `todos` holds
 * (the Logbook's pages, the details panel's reads) stays out.
 */
export function todayList<T extends Todo>(todos: T[], today: string, timeZone: string) {
  const rows = todos.filter(ownRow);
  const onToday = rows.filter((t) => isOnToday(t, today));
  const todayOpen = onToday.filter((t) => t.day === today).sort(byPosition);
  return {
    overdue: onToday.filter((t) => t.day !== today).sort(byDayThenPosition),
    today: todayOpen,
    closed: rows.filter((t) => t.state !== "open" && closedDay(t, timeZone) === today).sort(byClosedAt),
    remindersToCome: todayOpen.filter((t) => t.reminder?.status === "pending").length,
  };
}

/** A day and its To-dos, in the order the list shows them. */
type DayGroup<T extends Todo = Todo> = { day: string; todos: T[] };

/** How many days Upcoming shows one by one, starting tomorrow. */
const UPCOMING_DAYS = 14;

/**
 * Upcoming (docs/personal-space.md §7.3): the open rows of the next 14 days, one group per day (empty days
 * included), then "Later": every open row planned after them, grouped by day, only the days that have one. Each day
 * is in Position order.
 */
export function upcomingList<T extends Todo>(todos: T[], today: string) {
  const last = addDays(today, UPCOMING_DAYS);
  const byDay = new Map<string, T[]>();
  for (const t of todos) {
    if (t.state !== "open" || !ownRow(t) || t.day === null || t.day <= today) continue;
    const day = byDay.get(t.day);
    if (day) day.push(t);
    else byDay.set(t.day, [t]);
  }
  const group = (day: string): DayGroup<T> => ({ day, todos: (byDay.get(day) ?? []).sort(byPosition) });
  return {
    days: Array.from({ length: UPCOMING_DAYS }, (_, i) => group(addDays(today, i + 1))),
    later: [...byDay.keys()].filter((day) => day > last).sort().map(group),
  };
}

/**
 * Anytime (docs/personal-space.md §7.3): the open top-level To-dos without a day, by Position, each with its open
 * Sub-to-dos to show indented under it: the undated ones (its own bucket, by Position), then the dated ones by day.
 */
export function anytimeList<T extends Todo>(todos: T[]) {
  const open = todos.filter((t) => t.state === "open");
  const subTodos = new Map<string, T[]>();
  for (const t of open) {
    if (!t.parentId) continue;
    const siblings = subTodos.get(t.parentId);
    if (siblings) siblings.push(t);
    else subTodos.set(t.parentId, [t]);
  }
  return open
    .filter((t) => t.parentId === null && t.day === null)
    .sort(byPosition)
    .map((todo) => {
      const subs = subTodos.get(todo.id) ?? [];
      return { todo, undated: subs.filter((t) => t.day === null).sort(byPosition), dated: subs.filter((t) => t.day !== null).sort(byDayThenPosition) };
    });
}

/** Sorts after every Planned day. */
const ANYTIME_LAST = "9999-12-31";

/** By project (docs/personal-space.md §7.3): the open rows that reference `key`, by day (Anytime last), then Position. */
export function projectTodos<T extends Todo>(todos: T[], key: string) {
  return todos
    .filter((t) => t.state === "open" && ownRow(t) && t.references.some((r) => r.key === key))
    .sort((a, b) => (a.day ?? ANYTIME_LAST).localeCompare(b.day ?? ANYTIME_LAST) || byPosition(a, b));
}

/** Where the Logbook's loaded pages end: the last To-do of the last page (the API pages by `closedAt`, then id, both descending). */
export type LogbookEnd = { closedAt: string; id: string };

/** Newest first, as the API pages the Logbook. */
const byClosedAtDesc = (a: Todo, b: Todo) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "") || b.id.localeCompare(a.id);

/**
 * The Logbook (docs/personal-space.md §7.3): done and dropped To-dos (Sub-to-dos included) grouped by the day they
 * were closed in `timeZone`, newest first. With `end` (more pages to load), anything closed before the loaded pages
 * end stays out (a To-do the poll or the panel brought from further back), so no day shows ahead of the ones between.
 */
export function logbookList<T extends Todo>(todos: T[], timeZone: string, end: LogbookEnd | null): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  // Not closed after `end`, newest first: closedAt before it, or the same moment and an id not above it.
  const loaded = (t: Todo) => !end || (t.closedAt as string) > end.closedAt || (t.closedAt === end.closedAt && t.id >= end.id);
  const closed = todos.filter((t) => t.state !== "open" && t.closedAt && loaded(t));
  for (const t of closed.sort(byClosedAtDesc)) {
    const day = closedDay(t, timeZone) as string;
    const last = groups.at(-1);
    if (last?.day === day) last.todos.push(t);
    else groups.push({ day, todos: [t] });
  }
  return groups;
}

/**
 * The list menu's counts: Today (today plus Overdue), Anytime, and each Project key the open rows reference (an
 * undated Sub-to-do shows only under its parent, so it doesn't count). A key whose Project is deleted stays, greyed.
 */
export function listMenuCounts(todos: Todo[], today: string) {
  const open = todos.filter((t) => t.state === "open");
  const projects = new Map<string, { key: string; count: number; projectDeleted: boolean }>();
  for (const t of open.filter(ownRow)) {
    // The API reports a key once per Project; a key naming several counts the To-do once.
    for (const r of new Map(t.references.map((r) => [r.key, r])).values()) {
      const p = projects.get(r.key) ?? { key: r.key, count: 0, projectDeleted: r.projectDeleted };
      p.count++;
      projects.set(r.key, p);
    }
  }
  return {
    today: open.filter((t) => isOnToday(t, today)).length,
    anytime: open.filter((t) => t.parentId === null && t.day === null).length,
    projects: [...projects.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** "via Parla" for a To-do created with the `parla` Token. */
export const isFromParla = (source: string) => source.toLowerCase() === "parla";
