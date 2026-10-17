import type { Todo } from "@traccia/shared";

/** The Personal Space page's data: today (Owner timezone), the open To-dos and those closed today. */
export type PersonalSpaceData = { today: string; todos: Todo[] };

/** A To-do that gets its own row in the day lists: top level, or a Sub-to-do with its own Planned day. */
const ownRow = (t: Todo) => t.parentId === null || t.day !== null;

export const byPosition = (a: Todo, b: Todo) => a.position - b.position || a.id.localeCompare(b.id);
const byDayThenPosition = (a: Todo, b: Todo) => (a.day ?? "").localeCompare(b.day ?? "") || byPosition(a, b);
const byClosedAt = (a: Todo, b: Todo) => (a.closedAt ?? "").localeCompare(b.closedAt ?? "") || a.id.localeCompare(b.id);

/** Open with a Planned day that has passed: it shows in Today until it is moved or closed. */
export const isOverdue = (t: Pick<Todo, "state" | "day">, today: string) => t.state === "open" && t.day !== null && t.day < today;

/** An open To-do the Today list shows: Overdue, or planned for today. */
const isOnToday = (t: Todo, today: string) => t.state === "open" && ownRow(t) && t.day !== null && t.day <= today;

/**
 * The Today list (docs/personal-space.md §7.3). `todos` holds the open To-dos and those closed today: Overdue (oldest
 * day first), today's open To-dos by Position, then today's done and dropped ones in the order they were closed.
 */
export function todayList<T extends Todo>(todos: T[], today: string) {
  const rows = todos.filter(ownRow);
  const onToday = rows.filter((t) => isOnToday(t, today));
  const todayOpen = onToday.filter((t) => t.day === today).sort(byPosition);
  return {
    overdue: onToday.filter((t) => t.day !== today).sort(byDayThenPosition),
    today: todayOpen,
    closed: rows.filter((t) => t.state !== "open").sort(byClosedAt),
    remindersToCome: todayOpen.filter((t) => t.reminder?.status === "pending").length,
  };
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
