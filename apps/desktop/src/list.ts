import type { Todo } from "./api-client";
import { addDays, dayLabel } from "./days";

/**
 * The open To-dos as the window lists them (docs/desktop-app.md §3.2): Overdue, Today, one section per later day
 * that has To-dos, then Anytime. A Sub-to-do sits on its own Planned day, like any To-do.
 */
export type Section = {
  /** Stable across re-fetches: the kind, or the day. */
  key: string;
  kind: "overdue" | "today" | "day" | "anytime";
  /** The Planned day of a `today` or `day` section. */
  day: string | null;
  items: Todo[];
  /** Open To-dos in it, for the heading's count. */
  open: number;
};

const byPosition = (a: Todo, b: Todo) => a.position - b.position;

function section(
  kind: Section["kind"],
  key: string,
  day: string | null,
  items: Todo[],
): Section {
  return {
    key,
    kind,
    day,
    items,
    open: items.filter((t) => t.state === "open").length,
  };
}

/** Groups `todos` into sections, `today` being today's date in the Owner timezone. */
export function buildSections(todos: Todo[], today: string): Section[] {
  const overdue: Todo[] = [];
  const anytime: Todo[] = [];
  const days = new Map<string, Todo[]>([[today, []]]);
  for (const t of todos) {
    if (t.day === null) anytime.push(t);
    else if (t.day < today) overdue.push(t);
    else days.set(t.day, [...(days.get(t.day) ?? []), t]);
  }

  const sections: Section[] = [];
  if (overdue.length > 0) {
    overdue.sort(
      (a, b) =>
        (a.day as string).localeCompare(b.day as string) || byPosition(a, b),
    );
    sections.push(section("overdue", "overdue", null, overdue));
  }
  for (const day of [...days.keys()].sort()) {
    const items = (days.get(day) as Todo[]).sort(byPosition);
    sections.push(section(day === today ? "today" : "day", day, day, items));
  }
  if (anytime.length > 0) {
    sections.push(
      section("anytime", "anytime", null, anytime.sort(byPosition)),
    );
  }
  return sections;
}

/** A section's heading: "Overdue", "Today" with its date, "Tomorrow", "Mon 19 Oct" or "Anytime". */
export function headingOf(
  s: Section,
  today: string,
): { label: string; detail?: string } {
  switch (s.kind) {
    case "overdue":
      return { label: "Overdue" };
    case "anytime":
      return { label: "Anytime" };
    case "today":
      return { label: "Today", detail: dayLabel(today, "full") };
    case "day":
      return {
        label:
          s.day === addDays(today, 1)
            ? "Tomorrow"
            : dayLabel(s.day as string, "full"),
      };
  }
}

/** The title bar's "7 today · 15 open". */
export type ListCounts = { today: number; open: number };

/** Today counts a Planned day of today or earlier. */
export function listCounts(todos: Todo[], today: string): ListCounts {
  const open = todos.filter((t) => t.state === "open");
  return {
    today: open.filter((t) => t.day !== null && t.day <= today).length,
    open: open.length,
  };
}
