"use client";
import type { Todo } from "@traccia/shared";
import { Bell, CalendarDays, Check, X } from "lucide-react";
import { type CSSProperties, memo, type ReactNode, type Ref } from "react";
import { dayLabel } from "@/lib/personal/days";
import { hasPendingReminder, isFromParla, isOverdue } from "@/lib/personal/lists";
import { cn } from "@/lib/utils";
import { DayPicker } from "./day-picker";
import { ReminderPicker } from "./reminder-picker";
import { reminderDescription, ReminderTime } from "./reminder-time";
import { useTodoSelection } from "./selection";
import { useTodoActions } from "./todo-actions";
import { usePreview, useTodoError } from "./todo-status";
import { ROW_ICON_BUTTON, TodoMenu } from "./todo-menu";
import { TodoTitle } from "./todo-title";

/** What a sortable row needs from dnd-kit: the item's ref and transform, whether it is the one dragged, and its handle. */
export type RowDrag = { ref: Ref<HTMLLIElement>; style: CSSProperties; dragging: boolean; handle: ReactNode };

/**
 * The To-do as it shows: with the state its strike is drawing while a close (or reopen) from the check, the "…" menu or
 * the panel waits to be sent (`useTodoWrites` times it).
 */
function useShownTodo(todo: Todo): Todo {
  const preview = usePreview(todo.id);
  return preview ? { ...todo, state: preview } : todo;
}

/** What the check does: a click on an open To-do marks it done, on a closed one reopens it. */
export function useCheckToggle(todo: Todo) {
  const actions = useTodoActions();
  return { shown: useShownTodo(todo), toggle: () => void actions.update(todo, { state: todo.state === "open" ? "done" : "open" }) };
}

/** A refused write on a To-do, with a way to dismiss it: under its row, and in the details panel. */
export function TodoError({ todo, className }: { todo: Todo; className?: string }) {
  const { dismissError } = useTodoActions();
  const error = useTodoError(todo.id);
  if (!error) return null;
  return (
    <p role="alert" className={cn("flex items-center gap-2 text-[12px] text-destructive", className)}>
      {error}
      <button type="button" onClick={() => dismissError(todo.id)} aria-label="Dismiss" className="grid size-5 place-items-center rounded outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <X className="size-3" aria-hidden />
      </button>
    </p>
  );
}

/** A parent's `n/m`: done of its live Sub-to-dos, dropped ones left out. Nothing for a To-do without any. */
export function SubTodoCount({ todo, className }: { todo: Todo; className?: string }) {
  const count = todo.subTodos?.total ? todo.subTodos : null;
  if (!count) return null;
  return (
    <span className={cn("shrink-0 font-mono tabular-nums", className)} title={`${count.done} of ${count.total} Sub-to-dos done`}>
      {count.done}/{count.total}
    </span>
  );
}

/** The round check: open, done (accent with a tick) or dropped (a cross). A click closes an open To-do, reopens a closed one. */
export function TodoCheck({ state, title, onToggle }: { state: Todo["state"]; title: string; onToggle: () => void }) {
  return (
    // The padding is the 44 px touch target.
    <button
      type="button"
      data-todo-check
      aria-label={state === "open" ? `Mark “${title}” done` : `Reopen “${title}”`}
      onClick={onToggle}
      className="group/check relative z-[1] -m-[13px] grid shrink-0 place-items-center rounded-full p-[13px] outline-none md:-m-1.5 md:p-1.5 [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-ring"
    >
      <span
        data-state={state}
        className={cn(
          "grid size-[18px] place-items-center rounded-full border-[1.5px] transition-colors duration-150",
          state === "done" && "border-primary bg-primary text-primary-foreground",
          state === "dropped" && "border-muted-foreground/50 text-muted-foreground",
          state === "open" && "border-muted-foreground/60 group-hover/check:border-primary",
        )}
      >
        {state === "done" ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
        {state === "dropped" ? <X className="size-3" strokeWidth={2.5} aria-hidden /> : null}
      </span>
    </button>
  );
}

/** What a row shows besides its To-do: the day (where the list mixes days), a wrapping title, the parent in front. */
type RowProps = { todo: Todo; showDay?: boolean; wrap?: boolean; parentTitle?: string };

/**
 * One To-do line (docs/personal-space.md §7.4): check, Reminder time (opens the Reminder picker; `––:––` on hover
 * when there is none), title with Project chips, a dot when it has Details, the Sub-to-do count, "via Parla", the
 * Planned day where the list mixes days (red when Overdue; a calendar icon on hover otherwise), both opening the day
 * picker, and the "…" menu. A refused write shows under the row. On the page, a click anywhere else on the row (an
 * "Open" button stretched under the controls) selects it for the details panel. `wrap` lets a long title wrap instead
 * of cutting it short (the narrow panel's Sub-to-dos, which also put their day under the title); `parentTitle` puts a Sub-to-do's parent in front of its title
 * (Today's second block). `drag` makes it sortable (its handle shows on hover, left of the
 * check); `children` go under it, inside the item (Anytime's indented Sub-to-dos, which move with their parent).
 */
export function TodoRow({ showDay = false, wrap = false, drag, children, ...row }: RowProps & { drag?: RowDrag; children?: ReactNode }) {
  const { todo } = row;
  const selected = useTodoSelection()?.selectedId === todo.id;
  return (
    <li
      ref={drag?.ref}
      style={drag?.style}
      data-todo-id={todo.id}
      data-selected={selected || undefined}
      className={cn("rounded-md text-[13px]", drag?.dragging && "relative z-10 bg-card shadow-sm ring-1 ring-border")}
    >
      <RowBody {...row} showDay={showDay} wrap={wrap} selected={selected} handle={drag?.handle} />
      {children}
    </li>
  );
}

/**
 * The row inside its item. Memoised: dragging re-renders every sortable item (dnd-kit's context), and this is the part
 * that costs, so it only renders again when its own To-do, flags or handle change.
 */
const RowBody = memo(function RowBody({ todo, showDay, wrap, parentTitle, selected, handle }: Required<Pick<RowProps, "showDay" | "wrap">> & Omit<RowProps, "showDay" | "wrap"> & { selected: boolean; handle?: ReactNode }) {
  const actions = useTodoActions();
  const selection = useTodoSelection();
  const { today } = actions;
  const { shown, toggle } = useCheckToggle(todo);
  // In the narrow panel a dated row's day goes under its title: beside it, the title would wrap a few letters wide.
  const dayUnderTitle = wrap && showDay && todo.day !== null;
  const dayPicker = (
    <DayPicker day={todo.day} today={today} hasReminder={hasPendingReminder(todo)} onSelect={(day) => void actions.update(todo, { day })}>
      {showDay && todo.day ? (
        <button
          type="button"
          aria-label={`Change Planned day (${dayLabel(todo.day, today)})`}
          className={cn(
            "relative z-[1] shrink-0 rounded-md px-1.5 py-1 text-[11px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent",
            dayUnderTitle && "-ml-1.5 -mt-1 self-start py-0.5",
            isOverdue(todo, today) ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {dayLabel(todo.day, today)}
        </button>
      ) : (
        <button type="button" aria-label="Change Planned day" className={ROW_ICON_BUTTON}>
          <CalendarDays className="size-3.5" aria-hidden />
        </button>
      )}
    </DayPicker>
  );

  return (
    <>
      <div className={cn("group/row relative flex min-h-11 items-center gap-3 rounded-md px-2 md:min-h-9", selection && "hover:bg-accent/60", selected && "bg-accent hover:bg-accent")}>
        {handle}
        <TodoCheck state={shown.state} title={todo.title} onToggle={toggle} />
        <ReminderPicker day={todo.day} time={todo.reminder?.time ?? null} today={today} timeZone={actions.timeZone} onSelect={(time) => void actions.update(todo, { time })}>
          <button
            type="button"
            aria-label={todo.reminder ? `Change Reminder (${reminderDescription(todo.reminder)})` : "Add a Reminder"}
            className="group/time relative z-[1] -my-1 shrink-0 rounded-md py-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
          >
            {todo.reminder ? (
              <ReminderTime todo={shown} />
            ) : (
              <span
                aria-hidden
                className="flex w-11 items-center gap-1 font-mono text-[11px] text-transparent group-hover/row:text-muted-foreground/50 group-focus-visible/time:text-muted-foreground group-data-[state=open]/time:text-muted-foreground"
              >
                <Bell className="size-3" /> ––:––
              </span>
            )}
          </button>
        </ReminderPicker>
        {selection ? (
          <button
            type="button"
            data-todo-open
            aria-label={`Open “${todo.title}”`}
            aria-current={selected || undefined}
            onClick={() => selection.select(todo.id)}
            className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            {parentTitle ? (
              <span className="max-w-[40%] shrink-0 truncate text-[11px] text-muted-foreground" title={`Sub-to-do of ${parentTitle}`}>
                {parentTitle} ›
              </span>
            ) : null}
            <TodoTitle todo={shown} className={wrap ? "break-words py-1" : "truncate"} />
            {todo.details ? <span role="img" aria-label="Has details" className="size-1 shrink-0 rounded-full bg-muted-foreground/50" /> : null}
          </span>
          {dayUnderTitle ? dayPicker : null}
        </span>
        <SubTodoCount todo={todo} className="text-[10.5px] text-muted-foreground" />
        {isFromParla(todo.source) ? <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">via Parla</span> : null}
        {dayUnderTitle ? null : dayPicker}
        <TodoMenu todo={todo} />
      </div>
      <TodoError todo={todo} className="pb-1.5 pl-[84px] pr-2" />
    </>
  );
});
