import { Bell, Check } from "lucide-react";
import type { Project, Todo } from "./api-client";
import { dayLabel } from "./days";
import { buildSections, headingOf } from "./list";
import { titleSegments } from "./title";

/**
 * The open To-dos of variant G (docs/desktop-app.md §3.2 and §3.3): one scrolling list with sticky section
 * headings. Checking, dropping and opening a row come with step 04.
 */
export function TodoList({
  todos,
  projects,
  today,
  offline,
}: {
  todos: Todo[];
  projects: Project[];
  today: string;
  /** Changes are off: the checks are disabled. */
  offline: boolean;
}) {
  const byId = new Map(todos.map((t) => [t.id, t]));
  const names = new Map(projects.map((p) => [p.id, p.name]));
  return (
    <div className="pb-3">
      {buildSections(todos, today).map((section) => {
        const heading = headingOf(section, today);
        return (
          <section key={section.key} aria-label={heading.label}>
            <h2
              className={`sticky top-0 z-[1] flex items-baseline gap-1.5 bg-background px-4 pt-3 pb-1 text-[11.5px] font-semibold ${section.kind === "overdue" ? "text-destructive" : ""}`}
            >
              {heading.label}
              {heading.detail && (
                <small className="text-[11.5px] font-normal text-muted-foreground">
                  {heading.detail}
                </small>
              )}
              <span className="ml-auto font-normal text-muted-foreground">
                {section.open || ""}
              </span>
            </h2>
            {section.items.length === 0 ? (
              <p className="pt-1 pr-4 pb-2 pl-11 text-xs text-muted-foreground">
                Nothing planned.
              </p>
            ) : (
              section.items.map((todo) => (
                <Row
                  key={todo.id}
                  todo={todo}
                  parent={todo.parentId ? byId.get(todo.parentId) : undefined}
                  names={names}
                  showDay={section.kind === "overdue"}
                  offline={offline}
                />
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

function Row({
  todo,
  parent,
  names,
  showDay,
  offline,
}: {
  todo: Todo;
  parent: Todo | undefined;
  names: Map<string, string>;
  showDay: boolean;
  offline: boolean;
}) {
  const subs = todo.subTodos;
  return (
    <div
      data-todo={todo.id}
      className="relative mx-1.5 flex min-h-[34px] items-center gap-2.5 rounded-md px-2.5 py-1 hover:bg-accent"
    >
      <button
        type="button"
        aria-label="Mark done"
        disabled={offline}
        className="group grid size-[18px] flex-none place-items-center rounded-full border-[1.5px] border-input hover:border-primary disabled:hover:border-input"
      >
        <Check
          className="size-[11px] opacity-0"
          strokeWidth={3.2}
          aria-hidden="true"
        />
      </button>
      <span className="min-w-0 flex-1 leading-[1.35]">
        <Title todo={todo} names={names} />
        {parent && (
          <span className="mt-px block truncate text-[11px] text-muted-foreground opacity-80">
            ↳ <Title todo={parent} names={names} />
          </span>
        )}
      </span>
      {subs && subs.total > 0 && (
        <span
          className="flex-none font-mono text-[10.5px] text-muted-foreground tabular-nums"
          title="Sub-to-dos done"
        >
          {subs.done}/{subs.total}
        </span>
      )}
      {todo.reminder && <ReminderTime todo={todo} />}
      {showDay && todo.day && (
        <span className="flex-none text-[11px] text-destructive">
          {dayLabel(todo.day, "weekday")}
        </span>
      )}
    </div>
  );
}

/** The title with its `@KEY` chips (not clickable here), each named after its Project. */
function Title({
  todo,
  names,
}: {
  todo: Pick<Todo, "title" | "references">;
  names: Map<string, string>;
}) {
  return (
    <span>
      {titleSegments(todo.title, todo.references).map((s, i) =>
        "key" in s ? (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder.
            key={i}
            title={
              s.projectDeleted
                ? `${s.key} is deleted`
                : (names.get(s.projectId) ?? s.key)
            }
            className={`mx-px inline-flex translate-y-[-1px] items-center rounded-[4px] border bg-surface px-1 align-middle font-mono text-[10.5px] leading-4 font-medium tracking-wide text-foreground/80 ${s.projectDeleted ? "border-dashed text-muted-foreground/60" : ""}`}
          >
            {s.key}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder.
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

/** Orange while pending; dimmed once sent, skipped, or the To-do is closed; red when it failed. */
function ReminderTime({ todo }: { todo: Todo }) {
  const reminder = todo.reminder;
  if (!reminder) return null;
  const tone =
    reminder.status === "failed"
      ? "text-destructive"
      : todo.state === "open" && reminder.status === "pending"
        ? "text-primary"
        : "text-muted-foreground opacity-55";
  return (
    <span
      data-reminder={reminder.status}
      title={reminder.status === "failed" ? "The Reminder failed" : undefined}
      className={`inline-flex min-w-11 flex-none items-center justify-end gap-[3px] font-mono text-[11px] tabular-nums ${tone}`}
    >
      <Bell className="size-[11px]" strokeWidth={2.2} aria-hidden="true" />
      {reminder.time}
    </span>
  );
}
