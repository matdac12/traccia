"use client";
import type { Todo } from "@traccia/shared";
import { Bell, CalendarDays, Check, X } from "lucide-react";
import { startTransition, useState } from "react";
import { dayLabel } from "@/lib/personal/days";
import { isFromParla, isOverdue } from "@/lib/personal/lists";
import { cn } from "@/lib/utils";
import { DayPicker } from "./day-picker";
import { ReminderPicker } from "./reminder-picker";
import { reminderLabel, ReminderTime } from "./reminder-time";
import { useTodoSelection } from "./selection";
import { useTodoActions } from "./todo-actions";
import { ROW_ICON_BUTTON, TodoMenu } from "./todo-menu";
import { TodoTitle } from "./todo-title";

/** How long the strike takes to draw (TodoTitle's transition): the row stays in place until it is done. */
const STRIKE_MS = 300;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * What the check does: a click on an open To-do marks it done, on a closed one reopens it. `shown` is the To-do with the
 * state the check shows while the strike draws (about 300 ms, none under reduced motion), before the write moves it.
 */
export function useCheckToggle(todo: Todo) {
  const actions = useTodoActions();
  const [preview, setPreview] = useState<Todo["state"] | null>(null);
  const shown = preview ? { ...todo, state: preview } : todo;
  const toggle = () => {
    if (preview) return;
    const next = todo.state === "open" ? "done" : "open";
    setPreview(next);
    // Cleared with the write's own render, so the check never flashes back before the new state shows.
    const save = () => actions.update(todo, { state: next }).then(() => startTransition(() => setPreview(null)));
    if (reducedMotion()) void save();
    else setTimeout(save, STRIKE_MS);
  };
  return { shown, toggle };
}

/** A refused write on a To-do, with a way to dismiss it: under its row, and in the details panel. */
export function TodoError({ todo, className }: { todo: Todo; className?: string }) {
  const actions = useTodoActions();
  const error = actions.errorFor(todo.id);
  if (!error) return null;
  return (
    <p role="alert" className={cn("flex items-center gap-2 text-[12px] text-destructive", className)}>
      {error}
      <button type="button" onClick={() => actions.dismissError(todo.id)} aria-label="Dismiss" className="grid size-5 place-items-center rounded outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
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

/**
 * One To-do line (docs/personal-space.md §7.4): check, Reminder time (opens the Reminder picker; `––:––` on hover
 * when there is none), title with Project chips, a dot when it has Details, the Sub-to-do count, "via Parla", the
 * Planned day where the list mixes days (red when Overdue; a calendar icon on hover otherwise), both opening the day
 * picker, and the "…" menu. A refused write shows under the row. On the page, a click anywhere else on the row (an
 * "Open" button stretched under the controls) selects it for the details panel. `wrap` lets a long title wrap instead
 * of cutting it short (the narrow panel's Sub-to-dos).
 */
export function TodoRow({ todo, showDay = false, wrap = false }: { todo: Todo; showDay?: boolean; wrap?: boolean }) {
  const actions = useTodoActions();
  const selection = useTodoSelection();
  const { today } = actions;
  const { shown, toggle } = useCheckToggle(todo);
  const selected = selection?.selectedId === todo.id;

  return (
    <li data-todo-id={todo.id} data-selected={selected || undefined} className={cn("rounded-md px-2 text-[13px]", selection && "hover:bg-accent/60", selected && "bg-accent hover:bg-accent")}>
      <div className="group/row relative flex min-h-11 items-center gap-3 md:min-h-9">
        <TodoCheck state={shown.state} title={todo.title} onToggle={toggle} />
        <ReminderPicker day={todo.day} time={todo.reminder?.time ?? null} today={today} timeZone={actions.timeZone} onSelect={(time) => void actions.update(todo, { time })}>
          <button
            type="button"
            aria-label={todo.reminder ? `Change Reminder (${reminderLabel(todo.reminder)})` : "Add a Reminder"}
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
            className="absolute inset-y-0 -inset-x-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : null}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <TodoTitle todo={shown} className={wrap ? "break-words py-1" : "truncate"} />
          {todo.details ? <span role="img" aria-label="Has details" className="size-1 shrink-0 rounded-full bg-muted-foreground/50" /> : null}
        </span>
        <SubTodoCount todo={todo} className="text-[10.5px] text-muted-foreground" />
        {isFromParla(todo.source) ? <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">via Parla</span> : null}
        <DayPicker day={todo.day} today={today} hasReminder={todo.reminder !== null} onSelect={(day) => void actions.update(todo, { day })}>
          {showDay && todo.day ? (
            <button
              type="button"
              aria-label={`Change Planned day (${dayLabel(todo.day, today)})`}
              className={cn(
                "relative z-[1] shrink-0 rounded-md px-1.5 py-1 text-[11px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent",
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
        <TodoMenu todo={todo} />
      </div>
      <TodoError todo={todo} className="pb-1.5 pl-[76px]" />
    </li>
  );
}
