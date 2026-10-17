import { Sun } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/traccia/empty-state";
import { longDate, weekdayName } from "@/lib/personal/days";
import { type PersonalTodo, todayList } from "@/lib/personal/lists";
import { cn, plural } from "@/lib/utils";
import { ListHeading } from "./list-heading";
import { TodoRow } from "./todo-row";

export function SectionLabel({ children, count, tone, id }: { children: ReactNode; count?: number; tone?: "danger"; id?: string }) {
  return (
    <h3 id={id} className={cn("flex items-baseline gap-2 px-2 pb-1 pt-5 text-[11px] font-medium uppercase tracking-[0.08em]", tone === "danger" ? "text-destructive" : "text-muted-foreground")}>
      {children}
      {count !== undefined ? <span className="font-mono tabular-nums opacity-70">{count}</span> : null}
    </h3>
  );
}

/**
 * Today (docs/personal-space.md §7.3): the weekday masthead, then Overdue (each row with its day), today's open
 * To-dos by Position, and today's done and dropped ones at the bottom.
 */
export function TodayList({ todos, today }: { todos: PersonalTodo[]; today: string }) {
  const list = todayList(todos, today);
  const empty = list.overdue.length + list.today.length + list.closed.length === 0;
  return (
    <>
      <ListHeading masthead sub={`${longDate(today)} · ${list.today.length} open · ${plural(list.remindersToCome, "Reminder", "Reminders")} still to come`}>
        {weekdayName(today)}
      </ListHeading>
      {empty ? (
        <EmptyState icon={Sun} title="Nothing planned for today" className="rounded-lg border border-dashed py-12">
          Add a To-do with quick add. Type @ for a Project, or a time like 15:00 for a Reminder.
        </EmptyState>
      ) : (
        <>
          {list.overdue.length ? (
            <section aria-labelledby="personal-overdue">
              <SectionLabel id="personal-overdue" tone="danger" count={list.overdue.length}>Overdue</SectionLabel>
              <ul>
                {list.overdue.map((t) => <TodoRow key={t.id} todo={t} today={today} showDay />)}
              </ul>
            </section>
          ) : null}
          <section aria-labelledby="personal-today">
            <SectionLabel id="personal-today" count={list.today.length}>Today</SectionLabel>
            <ul>
              {list.today.map((t) => <TodoRow key={t.id} todo={t} today={today} />)}
            </ul>
            {list.closed.length ? (
              <ul aria-label="Closed today">
                {list.closed.map((t) => <TodoRow key={t.id} todo={t} today={today} />)}
              </ul>
            ) : null}
          </section>
        </>
      )}
    </>
  );
}
