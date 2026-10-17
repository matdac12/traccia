"use client";
import type { Todo } from "@traccia/shared";
import { Bell, CalendarDays } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { dayLabel, shortDate } from "@/lib/personal/days";
import { isFromParla, isOverdue } from "@/lib/personal/lists";
import { cn } from "@/lib/utils";
import { DayPicker } from "./day-picker";
import { MentionInput } from "./mention-input";
import { QuickAdd } from "./quick-add";
import { ReminderPicker } from "./reminder-picker";
import { reminderLabel, ReminderTime } from "./reminder-time";
import { useTodoSelection } from "./selection";
import { useTodoActions } from "./todo-actions";
import { SubTodoCount, TodoCheck, TodoError, TodoRow, useCheckToggle } from "./todo-row";
import { TodoTitle } from "./todo-title";

const FIELD =
  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent";
const LABEL = "text-[11px] font-medium text-muted-foreground";

/** "Today · Sat 17 Oct", or just "Thu 15 Oct" when the label is already the date. */
function dayText(day: string, today: string) {
  const label = dayLabel(day, today);
  const date = shortDate(day);
  return label === date ? date : `${label} · ${date}`;
}

/**
 * The details panel's body (docs/personal-space.md §7.6): the check and the editable title, the Planned day and
 * Reminder fields (the row's pickers), where it was created, Details, and for a top-level To-do its Sub-to-dos with
 * their own rows and an "Add a Sub-to-do" line. Every write goes through the page's `useTodoActions`. Edits in progress
 * are local state, so the poll and the revalidation after a write never reset them.
 */
export function TodoDetails({ todo, parent, subTodos }: { todo: Todo; parent: Todo | null; subTodos: Todo[] }) {
  const actions = useTodoActions();
  const selection = useTodoSelection();
  const { today } = actions;
  const { shown, toggle } = useCheckToggle(todo);
  const failed = todo.reminder?.status === "failed";

  return (
    <div className="space-y-5">
      {todo.parentId ? (
        <button
          type="button"
          onClick={() => selection?.select(todo.parentId)}
          className="-mx-1 block max-w-full truncate rounded px-1 text-left text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Sub-to-do of {parent?.title ?? "its parent"}
        </button>
      ) : null}
      <div className="flex items-start gap-3">
        <div className="pt-1">
          <TodoCheck state={shown.state} title={todo.title} onToggle={toggle} />
        </div>
        <EditableTitle todo={todo} state={shown.state} />
      </div>
      <TodoError todo={todo} />
      <dl className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-y-1 text-[12px]">
        <dt className="text-muted-foreground">Planned day</dt>
        <dd>
          <DayPicker day={todo.day} today={today} hasReminder={todo.reminder !== null} align="start" onSelect={(day) => void actions.update(todo, { day })}>
            <button
              type="button"
              aria-label={`Planned day: ${todo.day ? dayText(todo.day, today) : "Anytime"}`}
              className={cn(FIELD, isOverdue(todo, today) && "text-destructive", !todo.day && "text-muted-foreground")}
            >
              <CalendarDays className="size-3.5 shrink-0 opacity-60" aria-hidden />
              {todo.day ? dayText(todo.day, today) : "Anytime"}
            </button>
          </DayPicker>
        </dd>
        <dt className="text-muted-foreground">Reminder</dt>
        <dd>
          <ReminderPicker day={todo.day} time={todo.reminder?.time ?? null} today={today} timeZone={actions.timeZone} onSelect={(time) => void actions.update(todo, { time })}>
            <button type="button" aria-label={todo.reminder ? `Change Reminder (${reminderLabel(todo.reminder)})` : "Add a Reminder"} className={cn(FIELD, !todo.reminder && "text-muted-foreground")}>
              {todo.reminder ? (
                <ReminderTime todo={todo} />
              ) : (
                <>
                  <Bell className="size-3.5 shrink-0 opacity-60" aria-hidden /> Add a Reminder
                </>
              )}
            </button>
          </ReminderPicker>
        </dd>
        {failed ? <dd className="col-start-2 px-2 pb-1 text-[11px] text-destructive">Telegram refused it. Check the bot settings.</dd> : null}
        <dt className="text-muted-foreground">Created</dt>
        <dd className="px-2 text-muted-foreground">{isFromParla(todo.source) ? "via Parla" : "in the dashboard"}</dd>
      </dl>
      <DetailsField todo={todo} />
      {/* A closed To-do takes no new Sub-to-dos, so without any it has nothing to show here. */}
      {todo.parentId === null && (todo.state === "open" || subTodos.length) ? <SubTodos todo={todo} subTodos={subTodos} /> : null}
    </div>
  );
}

/**
 * A field's edit in progress, kept apart from the To-do so a refresh never resets it, and saved exactly once: on
 * blur or Enter, or when the panel goes away under it (back or forward to another selection fires no blur).
 */
function useDraft(commit: (value: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const latestCommit = useRef(commit);
  latestCommit.current = commit;
  const change = (value: string | null) => {
    pending.current = value;
    setDraft(value);
  };
  const finish = (save: boolean) => {
    const value = pending.current;
    if (value === null) return;
    change(null);
    if (save) latestCommit.current(value);
  };
  useEffect(
    () => () => {
      const value = pending.current;
      pending.current = null;
      if (value !== null) latestCommit.current(value);
    },
    [],
  );
  return { draft, change, finish };
}

/** The title with its chips (still links); a click elsewhere on it edits it with `@` autocomplete. Enter or blur saves, Esc cancels. */
function EditableTitle({ todo, state }: { todo: Todo; state: Todo["state"] }) {
  const actions = useTodoActions();
  const inputId = useId();
  const { draft, change, finish } = useDraft((value) => {
    const next = value.trim();
    if (next && next !== todo.title) void actions.update(todo, { title: next });
  });

  if (draft === null) {
    return (
      <div className="relative min-w-0 flex-1">
        {/* Stretched under the chips, which stay links. */}
        <button
          type="button"
          aria-label="Edit title"
          onClick={() => change(todo.title)}
          className="absolute -inset-x-1.5 inset-y-0 cursor-text rounded-md outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
        />
        <h2 className="pointer-events-none relative text-[15px] font-medium leading-snug [&_a]:pointer-events-auto">
          {/* The check's strike shows here too while it draws. */}
          <TodoTitle todo={{ ...todo, state }} />
        </h2>
      </div>
    );
  }
  return (
    <form
      className="min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        finish(true);
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        Title
      </label>
      <MentionInput
        id={inputId}
        value={draft}
        onValueChange={change}
        autoFocus
        maxLength={500}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          // The `@` list, when open, takes Esc first.
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }}
        inputClassName="-mx-1.5 w-[calc(100%+12px)] rounded-md border bg-transparent px-1.5 py-0.5 text-[15px] font-medium leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
    </form>
  );
}

/** Details as plain text: saved on blur when it changed. While it has focus, a refresh doesn't touch what is typed. */
function DetailsField({ todo }: { todo: Todo }) {
  const actions = useTodoActions();
  const id = useId();
  const saved = todo.details ?? "";
  const { draft, change, finish } = useDraft((value) => {
    // Only blanks clears it (the API takes an empty string as "no Details").
    const next = value.trim() ? value : "";
    if (next !== saved) void actions.update(todo, { details: next });
  });
  return (
    <div>
      <label htmlFor={id} className={cn(LABEL, "mb-1.5 block")}>
        Details
      </label>
      <Textarea
        id={id}
        value={draft ?? saved}
        onFocus={() => change(saved)}
        onChange={(e) => change(e.target.value)}
        onBlur={() => finish(true)}
        placeholder="Add details"
        rows={3}
        className="min-h-20 resize-none px-2.5 py-2 text-[13px] md:text-[13px]"
      />
    </div>
  );
}

/** A top-level To-do's Sub-to-dos, each a full row, then "Add a Sub-to-do" (quick add with day words and times). */
function SubTodos({ todo, subTodos }: { todo: Todo; subTodos: Todo[] }) {
  const { today } = useTodoActions();
  return (
    <section aria-labelledby={`sub-todos-${todo.id}`}>
      <h3 id={`sub-todos-${todo.id}`} className={cn(LABEL, "mb-1 flex gap-1.5")}>
        Sub-to-dos
        <SubTodoCount todo={todo} />
      </h3>
      {subTodos.length ? (
        <ul aria-label="Sub-to-dos" className="-mx-2">
          {subTodos.map((t) => (
            <TodoRow key={t.id} todo={t} showDay wrap />
          ))}
        </ul>
      ) : null}
      {/* The API only takes Sub-to-dos under an open parent. */}
      {todo.state === "open" ? <QuickAdd today={today} defaultDay={null} parentId={todo.id} placeholder="Add a Sub-to-do" className="mt-1" /> : null}
    </section>
  );
}
