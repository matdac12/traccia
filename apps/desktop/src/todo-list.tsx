import { Bell, Check, ChevronDown, X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type { Project, Todo } from "./api-client";
import { clockIn, dayLabel } from "./days";
import type { Leaving } from "./leaving";
import { headingOf, type ListLayout } from "./list";
import type { CascadeConfirm } from "./row-actions";
import { titleSegments } from "./title";

/** What a row can ask for (docs/desktop-app.md §4); the list itself holds no state. */
export type RowHandlers = {
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onDrop: (id: string) => void;
  onOpen: (todo: Todo) => void;
  onConfirmCascade: () => void;
  onCancelCascade: () => void;
};

/**
 * The To-dos of variant G (docs/desktop-app.md §3.2 to §3.4): one scrolling list with sticky section headings, and
 * the Done today shelf under them. A row closed during this show strikes through, then folds away.
 */
export function TodoList({
  todos,
  layout,
  leaving,
  shelfOpen,
  onToggleShelf,
  projects,
  today,
  timeZone,
  offline,
  selectedId,
  confirm,
  handlers,
}: {
  /** Every To-do the list knows, for the Sub-to-dos' parent lines. */
  todos: Todo[];
  layout: ListLayout;
  leaving: Leaving;
  shelfOpen: boolean;
  onToggleShelf: () => void;
  projects: Project[];
  today: string;
  /** The Owner timezone, for the shelf's closing times. */
  timeZone: string;
  /** Changes are off: the checks are disabled. */
  offline: boolean;
  selectedId: string | null;
  confirm: CascadeConfirm | null;
  handlers: RowHandlers;
}) {
  const byId = new Map(todos.map((t) => [t.id, t]));
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const { sections, shelf } = layout;
  return (
    <div className="pb-3">
      {sections.map((section) => {
        const heading = headingOf(section, today);
        const allDone =
          section.kind === "today" && shelf.some((t) => t.day === today);
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
                {allDone ? "All done for today." : "Nothing planned."}
              </p>
            ) : (
              section.items.map((todo) => (
                <Fold
                  key={todo.id}
                  folding={
                    todo.state !== "open" && leaving.get(todo.id) === "fold"
                  }
                >
                  <Row
                    todo={todo}
                    parent={todo.parentId ? byId.get(todo.parentId) : undefined}
                    names={names}
                    showDay={section.kind === "overdue"}
                    offline={offline}
                    selected={todo.id === selectedId}
                    handlers={handlers}
                  />
                  {confirm?.id === todo.id && (
                    <CascadeLine confirm={confirm} handlers={handlers} />
                  )}
                </Fold>
              ))
            )}
          </section>
        );
      })}
      {shelf.length > 0 && (
        <section aria-label="Done today" className="mt-2 border-t pt-1">
          <h2 className="flex items-baseline px-4 pt-2 pb-1 text-[11.5px] font-semibold text-muted-foreground">
            <button
              type="button"
              aria-expanded={shelfOpen}
              onClick={onToggleShelf}
              className="-ml-1 flex items-center gap-1 rounded-sm hover:text-foreground"
            >
              <ChevronDown
                className={`size-3.5 transition-transform motion-reduce:transition-none ${shelfOpen ? "" : "-rotate-90"}`}
                strokeWidth={2.2}
                aria-hidden="true"
              />
              Done today
            </button>
            <span className="ml-auto font-normal">{shelf.length}</span>
          </h2>
          {shelfOpen &&
            shelf.map((todo) => (
              <ShelfRow
                key={todo.id}
                todo={todo}
                parent={todo.parentId ? byId.get(todo.parentId) : undefined}
                names={names}
                closedAt={clockIn(timeZone, new Date(todo.closedAt as string))}
                offline={offline}
                selected={todo.id === selectedId}
                handlers={handlers}
              />
            ))}
        </section>
      )}
    </div>
  );
}

/** Folds a leaving row's height to nothing, so the rows below slide up instead of jumping (§3.4). */
function Fold({
  folding,
  children,
}: {
  folding: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${folding ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]"}`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** A selected row has the accent background; a hovered one a lighter shade of it (§4). */
const rowTone = (selected: boolean) =>
  selected ? "bg-accent" : "hover:bg-accent/60";

const CHECK_TONE = {
  open: "border-input hover:border-primary disabled:hover:border-input",
  done: "border-primary bg-primary text-primary-foreground",
  dropped: "border-muted-foreground text-muted-foreground",
} as const;

function Row({
  todo,
  parent,
  names,
  showDay,
  offline,
  selected,
  handlers,
}: {
  todo: Todo;
  parent: Todo | undefined;
  names: Map<string, string>;
  showDay: boolean;
  offline: boolean;
  selected: boolean;
  handlers: RowHandlers;
}) {
  const subs = todo.subTodos;
  const open = todo.state === "open";
  /** A click on a part of the row: selects the row too. */
  const act = (run: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    handlers.onSelect(todo.id);
    run();
  };
  return (
    // Clicking the row's empty area selects it; right-click drops it (§4). The list's keyboard selection (↑ ↓,
    // Space, Del, Enter) is the keyboard way to do the same.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard selection lives on the list, not on each row.
    // biome-ignore lint/a11y/noStaticElementInteractions: as above.
    <div
      data-todo={todo.id}
      data-state={todo.state}
      data-selected={selected || undefined}
      onClick={() => handlers.onSelect(todo.id)}
      onContextMenu={(event) => {
        event.preventDefault();
        act(() => handlers.onDrop(todo.id))(event);
      }}
      className={`relative mx-1.5 flex min-h-[34px] items-center gap-2.5 rounded-md px-2.5 py-1 ${rowTone(selected)}`}
    >
      <button
        type="button"
        aria-label={open ? "Mark done" : "Reopen"}
        disabled={offline}
        onClick={act(() => handlers.onToggle(todo.id))}
        className={`grid size-[18px] flex-none place-items-center rounded-full border-[1.5px] ${CHECK_TONE[todo.state]}`}
      >
        {todo.state === "dropped" ? (
          <X className="size-[11px]" strokeWidth={3} aria-hidden="true" />
        ) : (
          <Check
            className={`size-[11px] ${open ? "opacity-0" : ""}`}
            strokeWidth={3.2}
            aria-hidden="true"
          />
        )}
      </button>
      <button
        type="button"
        title="Open in the dashboard"
        onClick={act(() => handlers.onOpen(todo))}
        className="todo-title min-w-0 flex-1 cursor-pointer text-left leading-[1.35]"
      >
        <span className="todo-strike">
          <Title todo={todo} names={names} />
        </span>
        {parent && (
          <span className="mt-px block truncate text-[11px] text-muted-foreground opacity-80">
            ↳ <Title todo={parent} names={names} />
          </span>
        )}
      </button>
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

/**
 * A row on the Done today shelf (§3.4): dimmed, no line, the time it was closed. Its check reopens it, back to its
 * section; its title opens it in the dashboard.
 */
function ShelfRow({
  todo,
  parent,
  names,
  closedAt,
  offline,
  selected,
  handlers,
}: {
  todo: Todo;
  parent: Todo | undefined;
  names: Map<string, string>;
  closedAt: string;
  offline: boolean;
  selected: boolean;
  handlers: RowHandlers;
}) {
  const act = (run: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    handlers.onSelect(todo.id);
    run();
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard selection lives on the list, as for the other rows.
    // biome-ignore lint/a11y/noStaticElementInteractions: as above.
    <div
      data-todo={todo.id}
      data-state={todo.state}
      data-selected={selected || undefined}
      onClick={() => handlers.onSelect(todo.id)}
      className={`relative mx-1.5 flex min-h-[30px] items-center gap-2.5 rounded-md px-2.5 py-0.5 ${rowTone(selected)}`}
    >
      <button
        type="button"
        aria-label="Reopen"
        disabled={offline}
        onClick={act(() => handlers.onToggle(todo.id))}
        className="grid size-[18px] flex-none place-items-center rounded-full border-[1.5px] border-primary/50 bg-primary/15 text-primary"
      >
        <Check className="size-[11px]" strokeWidth={3.2} aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Open in the dashboard"
        onClick={act(() => handlers.onOpen(todo))}
        className="min-w-0 flex-1 cursor-pointer text-left leading-[1.35] text-muted-foreground hover:text-foreground"
      >
        <span className="block truncate">
          <Title todo={todo} names={names} />
        </span>
        {parent && (
          <span className="block truncate text-[11px] opacity-70">
            ↳ <Title todo={parent} names={names} />
          </span>
        )}
      </button>
      <span
        className="flex-none font-mono text-[10.5px] text-muted-foreground tabular-nums"
        title="Done at"
      >
        {closedAt}
      </span>
    </div>
  );
}

/** "Also mark 2 open Sub-to-dos done? [Yes ↵] [Cancel]" under the parent (§4). */
function CascadeLine({
  confirm,
  handlers,
}: {
  confirm: CascadeConfirm;
  handlers: RowHandlers;
}) {
  const subs = confirm.count === 1 ? "Sub-to-do" : "Sub-to-dos";
  return (
    <div
      data-cascade={confirm.id}
      className="mt-0.5 mr-4 mb-1.5 ml-11 flex items-center gap-2 rounded-md border bg-surface px-2.5 py-2 text-xs"
    >
      <span className="flex-1">
        Also mark {confirm.count} open {subs} {confirm.state}?
      </span>
      <button
        type="button"
        onClick={handlers.onConfirmCascade}
        className="inline-flex h-6 items-center gap-1 rounded-[5px] bg-primary px-[9px] font-medium text-primary-foreground"
      >
        Yes
        <kbd className="rounded-[3px] border border-black/20 px-1 font-mono text-[10px] font-normal">
          ↵
        </kbd>
      </button>
      <button
        type="button"
        onClick={handlers.onCancelCascade}
        className="h-6 rounded-[5px] border bg-card px-[9px]"
      >
        Cancel
      </button>
    </div>
  );
}

/** A `@KEY` chip, in a row's title and in the composer's `@` list. */
export const CHIP =
  "mx-px inline-flex translate-y-[-1px] items-center rounded-[4px] border bg-surface px-1 align-middle font-mono text-[10.5px] leading-4 font-medium tracking-wide text-foreground/80";

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
            className={`${CHIP} ${s.projectDeleted ? "border-dashed text-muted-foreground/60" : ""}`}
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
