import type { Todo } from "@traccia/shared";
import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/traccia/empty-state";
import { anytimeList } from "@/lib/personal/lists";
import { ListHeading } from "./list-heading";
import { QuickAdd } from "./quick-add";
import { SortableGroup, SortableRows, SortableTodoRow } from "./sortable-rows";
import { TodoRow } from "./todo-row";

/**
 * Anytime (docs/personal-space.md §7.3): quick add with no day, then the open top-level To-dos without a day in
 * manual order, each parent with its open Sub-to-dos indented under a left rule (the undated ones first, in their own
 * order, then the dated ones with their day). Top-level rows drag among themselves, a parent's undated Sub-to-dos
 * among themselves.
 */
export function AnytimeList({ todos, today }: { todos: Todo[]; today: string }) {
  const groups = anytimeList(todos);
  const tops = groups.map((g) => g.todo);
  return (
    <>
      <ListHeading sub="To-dos without a Planned day. Give one a day when it is time.">Anytime</ListHeading>
      <QuickAdd today={today} defaultDay={null} placeholder="Add to Anytime. Type @ for a Project" className="mb-3" />
      {groups.length ? (
        <SortableRows id="personal-anytime" rows={[...tops, ...groups.flatMap((g) => g.undated)]}>
          <SortableGroup rows={tops}>
            <ul aria-label="Anytime">
              {groups.map(({ todo, undated, dated }) => (
                <SortableTodoRow key={todo.id} todo={todo}>
                  {undated.length + dated.length ? (
                    <ul aria-label={`Sub-to-dos of ${todo.title}`} className="mb-1 ml-7 border-l pl-6">
                      <SortableGroup rows={undated}>
                        {undated.map((t) => (
                          <SortableTodoRow key={t.id} todo={t} />
                        ))}
                      </SortableGroup>
                      {dated.map((t) => (
                        <TodoRow key={t.id} todo={t} showDay />
                      ))}
                    </ul>
                  ) : null}
                </SortableTodoRow>
              ))}
            </ul>
          </SortableGroup>
        </SortableRows>
      ) : (
        <EmptyState icon={Inbox} title="Nothing in Anytime" className="rounded-lg border border-dashed py-12">
          A To-do added without a day lands here.
        </EmptyState>
      )}
    </>
  );
}
