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
import { useTodoActions } from "./todo-actions";
import { ROW_ICON_BUTTON, TodoMenu } from "./todo-menu";
import { TodoTitle } from "./todo-title";

/** How long the strike takes to draw (TodoTitle's transition): the row stays in place until it is done. */
const STRIKE_MS = 300;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The round check: open, done (accent with a tick) or dropped (a cross). A click closes an open To-do, reopens a closed one. */
export function TodoCheck({ state, title, onToggle }: { state: Todo["state"]; title: string; onToggle: () => void }) {
  return (
    // The padding is the 44 px touch target.
    <button
      type="button"
      data-todo-check
      aria-label={state === "open" ? `Mark “${title}” done` : `Reopen “${title}”`}
      onClick={onToggle}
      className="group/check -m-[13px] grid shrink-0 place-items-center rounded-full p-[13px] outline-none md:-m-1.5 md:p-1.5 [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-ring"
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
 * picker, and the "…" menu. A refused write shows under the row.
 */
export function TodoRow({ todo, showDay = false }: { todo: Todo; showDay?: boolean }) {
  const actions = useTodoActions();
  const { today } = actions;
  // The state the check shows while the strike draws, before the write moves the row.
  const [preview, setPreview] = useState<Todo["state"] | null>(null);
  const shown = preview ? { ...todo, state: preview } : todo;
  const subTodos = todo.subTodos?.total ? todo.subTodos : null;
  const error = actions.errorFor(todo.id);

  const toggle = () => {
    if (preview) return;
    const next = todo.state === "open" ? "done" : "open";
    setPreview(next);
    // Cleared with the write's own render, so the check never flashes back before the new state shows.
    const save = () => actions.update(todo, { state: next }).then(() => startTransition(() => setPreview(null)));
    if (reducedMotion()) void save();
    else setTimeout(save, STRIKE_MS);
  };

  return (
    <li data-todo-id={todo.id} className="rounded-md px-2 text-[13px]">
      <div className="group/row relative flex min-h-11 items-center gap-3 md:min-h-9">
        <TodoCheck state={shown.state} title={todo.title} onToggle={toggle} />
        <ReminderPicker day={todo.day} time={todo.reminder?.time ?? null} today={today} timeZone={actions.timeZone} onSelect={(time) => void actions.update(todo, { time })}>
          <button
            type="button"
            aria-label={todo.reminder ? `Change Reminder (${reminderLabel(todo.reminder)})` : "Add a Reminder"}
            className="group/time -my-1 shrink-0 rounded-md py-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
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
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <TodoTitle todo={shown} className="truncate" />
          {todo.details ? <span role="img" aria-label="Has details" className="size-1 shrink-0 rounded-full bg-muted-foreground/50" /> : null}
        </span>
        {subTodos ? (
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground tabular-nums" title={`${subTodos.done} of ${subTodos.total} Sub-to-dos done`}>
            {subTodos.done}/{subTodos.total}
          </span>
        ) : null}
        {isFromParla(todo.source) ? <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">via Parla</span> : null}
        <DayPicker day={todo.day} today={today} hasReminder={todo.reminder !== null} onSelect={(day) => void actions.update(todo, { day })}>
          {showDay && todo.day ? (
            <button
              type="button"
              aria-label={`Change Planned day (${dayLabel(todo.day, today)})`}
              className={cn(
                "shrink-0 rounded-md px-1.5 py-1 text-[11px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent",
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
      {error ? (
        <p role="alert" className="flex items-center gap-2 pb-1.5 pl-[76px] text-[12px] text-destructive">
          {error}
          <button type="button" onClick={() => actions.dismissError(todo.id)} aria-label="Dismiss" className="grid size-5 place-items-center rounded outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-3" aria-hidden />
          </button>
        </p>
      ) : null}
    </li>
  );
}
