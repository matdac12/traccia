import type { Todo } from "@traccia/shared";
import { dayLabel } from "@/lib/personal/days";
import { upcomingList } from "@/lib/personal/lists";
import { DaySection, ListHeading, SectionLabel } from "./list-heading";
import { TodoRow } from "./todo-row";

/**
 * Upcoming (docs/personal-space.md §7.3): the next 14 days, one section per day ("Tomorrow", "Mon 19 Oct"…), empty
 * ones dimmed; then "Later", every open To-do planned after them, one section per day that has one. Rows show no day:
 * their section says it.
 */
export function UpcomingList({ todos, today }: { todos: Todo[]; today: string }) {
  const { days, later } = upcomingList(todos, today);
  const section = ({ day, todos }: { day: string; todos: Todo[] }) => (
    <DaySection key={day} id={`personal-day-${day}`} label={dayLabel(day, today)} empty={todos.length === 0}>
      {todos.length ? (
        <ul>
          {todos.map((t) => (
            <TodoRow key={t.id} todo={t} />
          ))}
        </ul>
      ) : null}
    </DaySection>
  );
  return (
    <>
      <ListHeading>Upcoming</ListHeading>
      {days.map(section)}
      {later.length ? (
        <section aria-labelledby="personal-later" className="mt-6">
          <SectionLabel id="personal-later" count={later.reduce((n, g) => n + g.todos.length, 0)}>
            Later
          </SectionLabel>
          {later.map(section)}
        </section>
      ) : null}
    </>
  );
}
