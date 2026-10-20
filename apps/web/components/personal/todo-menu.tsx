"use client";
import type { Todo } from "@traccia/shared";
import { Bell, CalendarDays, Check, Inbox, MoreHorizontal, RotateCcw, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { addDays, dayLabel, isMomentPast, ownerNow } from "@/lib/personal/days";
import { hasPendingReminder } from "@/lib/personal/lists";
import type { TodoPatch } from "@/lib/personal/todo-changes";
import { REMINDER_PRESETS } from "./reminder-picker";
import { useTodoActions } from "./todo-actions";

/** Revealed on row hover or focus from `md` up; always shown on touch widths. Above the row's "Open" button. */
export const ROW_ICON_BUTTON =
  "relative z-[1] grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100";

/**
 * The row's "…" menu (docs/personal-space.md §7.5): Move to (the next 7 days, or Anytime), Reminder, Mark done, Drop
 * or Reopen, and Delete (to the Trash, so no confirm). It is the single-pointer alternative to drag (WCAG 2.2).
 */
export function TodoMenu({ todo }: { todo: Todo }) {
  return (
    // Not modal: a confirm dialog may open from an item, and a modal menu closing under it would leave the page inert.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Actions for ${todo.title}`} className={ROW_ICON_BUTTON}>
          <MoreHorizontal className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {/* Its own component, so a closed menu costs a row nothing; it mounts (and reads "now") on each opening. */}
        <TodoMenuItems todo={todo} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TodoMenuItems({ todo }: { todo: Todo }) {
  const actions = useTodoActions();
  const { today } = actions;
  const [now] = useState(() => ownerNow(actions.timeZone));
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const reminderDay = todo.day ?? today;
  const update = (patch: TodoPatch) => void actions.update(todo, patch);

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <CalendarDays className="size-3.5" aria-hidden /> Move to
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-64">
          {days.map((d) => (
            <DropdownMenuItem key={d} disabled={todo.day === d} onSelect={() => update({ day: d })}>
              {dayLabel(d, today)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={todo.day === null} onSelect={() => update({ day: null })}>
            <Inbox className="size-3.5" aria-hidden /> Anytime
            {hasPendingReminder(todo) ? <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">removes the Reminder</span> : null}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Bell className="size-3.5" aria-hidden /> Reminder
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-44">
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
            {todo.reminder ? `At ${todo.reminder.time}` : "None yet"} · {dayLabel(reminderDay, today)}
          </DropdownMenuLabel>
          {REMINDER_PRESETS.map((h) => (
            <DropdownMenuItem key={h} disabled={todo.reminder?.time === h || isMomentPast(reminderDay, h, now)} onSelect={() => update({ time: h })}>
              <span className="font-mono">{h}</span>
            </DropdownMenuItem>
          ))}
          {todo.reminder ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => update({ time: null })}>Remove Reminder</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      {todo.state === "open" ? (
        <>
          <DropdownMenuItem onSelect={() => update({ state: "done" })}>
            <Check className="size-3.5" aria-hidden /> Mark done
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => update({ state: "dropped" })}>
            <X className="size-3.5" aria-hidden /> Drop
          </DropdownMenuItem>
        </>
      ) : (
        <DropdownMenuItem onSelect={() => update({ state: "open" })}>
          <RotateCcw className="size-3.5" aria-hidden /> Reopen
        </DropdownMenuItem>
      )}
      <DropdownMenuItem variant="destructive" onSelect={() => actions.deleteTodo(todo)}>
        <Trash2 className="size-3.5" aria-hidden /> Delete
      </DropdownMenuItem>
    </>
  );
}
