import type { Todo } from "@traccia/shared";
import { Check, X } from "lucide-react";
import { dayLabel } from "@/lib/personal/days";
import { isFromParla, isOverdue } from "@/lib/personal/lists";
import { cn } from "@/lib/utils";
import { ReminderTime } from "./reminder-time";
import { TodoTitle } from "./todo-title";

const STATE_LABEL = { open: "Open", done: "Done", dropped: "Dropped" } as const;

/** The round check: open, done (accent with a tick) or dropped (a cross). Display only until TRC-161. */
export function TodoCheck({ state }: { state: Todo["state"] }) {
  return (
    // The padding is the 44 px touch target the button will have (TRC-161).
    <span className="-m-3 grid shrink-0 place-items-center p-3 md:-m-1.5 md:p-1.5">
      <span
        role="img"
        aria-label={STATE_LABEL[state]}
        className={cn(
          "grid size-[18px] place-items-center rounded-full border-[1.5px] transition-colors duration-150",
          state === "done" && "border-primary bg-primary text-primary-foreground",
          state === "dropped" && "border-muted-foreground/50 text-muted-foreground",
          state === "open" && "border-muted-foreground/60",
        )}
      >
        {state === "done" ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
        {state === "dropped" ? <X className="size-3" strokeWidth={2.5} aria-hidden /> : null}
      </span>
    </span>
  );
}

/**
 * One To-do line (docs/personal-space.md §7.4): check, Reminder time, title with Project chips, a dot when it has
 * Details, the Sub-to-do count, "via Parla", and the Planned day where the list mixes days (red when Overdue).
 */
export function TodoRow({ todo, today, showDay = false }: { todo: Todo; today: string; showDay?: boolean }) {
  const subTodos = todo.subTodos?.total ? todo.subTodos : null;
  return (
    <li data-todo-id={todo.id} className="group/row relative flex min-h-11 items-center gap-3 rounded-md px-2 text-[13px] md:min-h-9">
      <TodoCheck state={todo.state} />
      <ReminderTime todo={todo} />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <TodoTitle todo={todo} className="truncate" />
        {todo.details ? <span role="img" aria-label="Has details" className="size-1 shrink-0 rounded-full bg-muted-foreground/50" /> : null}
      </span>
      {subTodos ? (
        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground tabular-nums" title={`${subTodos.done} of ${subTodos.total} Sub-to-dos done`}>
          {subTodos.done}/{subTodos.total}
        </span>
      ) : null}
      {isFromParla(todo.source) ? <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">via Parla</span> : null}
      {/* TRC-161 turns the day into the day picker, and puts a calendar icon (its slot) and the "..." menu here. */}
      {showDay && todo.day ? (
        <span className={cn("shrink-0 px-1.5 text-[11px]", isOverdue(todo, today) ? "text-destructive" : "text-muted-foreground")}>{dayLabel(todo.day, today)}</span>
      ) : (
        <span aria-hidden className="w-7 shrink-0" />
      )}
      <span aria-hidden className="w-7 shrink-0" />
    </li>
  );
}
