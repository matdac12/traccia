import type { Todo } from "@traccia/shared";
import { Sun } from "lucide-react";
import { EmptyState } from "@/components/traccia/empty-state";
import { longDate, weekdayName } from "@/lib/personal/days";
import { todayList } from "@/lib/personal/lists";
import { plural } from "@/lib/utils";
import { ListHeading, SectionLabel } from "./list-heading";
import { QuickAdd } from "./quick-add";
import { SortableGroup, SortableRows, SortableTodoRow } from "./sortable-rows";
import { TodoRow } from "./todo-row";

/**
 * Today (docs/personal-space.md §7.3): the weekday masthead, quick add (onto today), then Overdue (each row with its
 * day), today's open top-level To-dos by Position (drag to reorder), then today's dated Sub-to-dos as a block of their
 * own (each with its parent's title in front, dragged among its own parent's), and today's done and dropped ones at the
 * bottom.
 */
export function TodayList({ todos, today, timeZone }: { todos: Todo[]; today: string; timeZone: string }) {
  const list = todayList(todos, today, timeZone);
  const open = list.today.length + list.subTodos.length;
  const empty = list.overdue.length + open + list.closed.length === 0;
  const titles = new Map(todos.map((t) => [t.id, t.title]));
  return (
    <>
      <ListHeading masthead sub={`${longDate(today)} · ${open} open · ${plural(list.remindersToCome, "Reminder", "Reminders")} still to come`}>
        {weekdayName(today)}
      </ListHeading>
      <QuickAdd today={today} defaultDay={today} className="mb-2" />
      {empty ? (
        <EmptyState icon={Sun} title="Nothing planned for today" className="rounded-lg border border-dashed py-12">
          Add one with quick add above. Type @ for a Project, or a time like 15:00 for a Reminder.
        </EmptyState>
      ) : (
        <>
          {list.overdue.length ? (
            <section aria-labelledby="personal-overdue">
              <SectionLabel id="personal-overdue" tone="danger" count={list.overdue.length}>Overdue</SectionLabel>
              <ul>
                {list.overdue.map((t) => <TodoRow key={t.id} todo={t} showDay />)}
              </ul>
            </section>
          ) : null}
          <section aria-labelledby="personal-today">
            <SectionLabel id="personal-today" count={open}>Today</SectionLabel>
            <SortableRows id="personal-today" rows={[...list.today, ...list.subTodos]}>
              <SortableGroup rows={list.today}>
                <ul>
                  {list.today.map((t) => (
                    <SortableTodoRow key={t.id} todo={t} />
                  ))}
                </ul>
              </SortableGroup>
              {list.subTodos.length ? (
                <SortableGroup rows={list.subTodos}>
                  <ul aria-label="Today's Sub-to-dos">
                    {list.subTodos.map((t) => (
                      <SortableTodoRow key={t.id} todo={t} parentTitle={titles.get(t.parentId as string)} />
                    ))}
                  </ul>
                </SortableGroup>
              ) : null}
            </SortableRows>
            {list.closed.length ? (
              <ul aria-label="Closed today">
                {list.closed.map((t) => <TodoRow key={t.id} todo={t} />)}
              </ul>
            ) : null}
          </section>
        </>
      )}
    </>
  );
}
