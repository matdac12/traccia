"use client";
import { CornerDownLeft, Plus } from "lucide-react";
import { type FormEvent, useId, useState, useTransition } from "react";
import { createTodoAction } from "@/app/(app)/personal/actions";
import { firstError } from "@/lib/action-message";
import { dayLabel } from "@/lib/personal/days";
import { parseQuickAdd } from "@/lib/personal/quick-add";
import { cn } from "@/lib/utils";
import { MentionInput } from "./mention-input";
import { useProjectOptions } from "./projects-context";
import { ReminderTime } from "./reminder-time";
import { TodoTitle } from "./todo-title";

/**
 * Quick add (docs/personal-space.md §7.5): one line with `@` autocomplete, a day word and a time. A read-back line
 * shows what it understood (Reminder time, title with chips, day) before Enter. A line with no day word goes to
 * `defaultDay` (null for Anytime); a time alone means today. With a `parentId` it adds a Sub-to-do of that To-do (the
 * details panel's "Add a Sub-to-do").
 */
export function QuickAdd({
  today,
  defaultDay,
  parentId,
  placeholder = "Add a To-do. Type @ for a Project, or: call Luca tomorrow 15:00",
  className,
}: {
  today: string;
  defaultDay: string | null;
  parentId?: string;
  placeholder?: string;
  className?: string;
}) {
  const projects = useProjectOptions();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();
  const readBackId = useId();
  const errorId = useId();

  const parsed = parseQuickAdd(value, today);
  const day = parsed.day ?? defaultDay;
  // Every live Project's key, as the API would derive references from the title once saved.
  const references = projects.map((p) => ({ key: p.key, projectId: p.id, projectDeleted: false }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.title || pending) return;
    startTransition(async () => {
      const result = await createTodoAction({ title: parsed.title, day, time: parsed.time, parentId });
      if (result.ok) {
        setValue("");
        setError(null);
      } else {
        setError(firstError(result));
      }
    });
  };

  return (
    <form onSubmit={submit} aria-busy={pending} className={cn("rounded-lg border bg-card", className)}>
      {/* Not a wrapping label: the autocomplete list inside would become part of the input's name. */}
      <div className="flex h-10 items-center gap-2 px-3">
        <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <label htmlFor={inputId} className="sr-only">
          {parentId ? "Add a Sub-to-do" : "New To-do"}
        </label>
        <MentionInput
          id={inputId}
          value={value}
          onValueChange={(next) => {
            setValue(next);
            setError(null);
          }}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={[parsed.title && readBackId, error && errorId].filter(Boolean).join(" ") || undefined}
          className="min-w-0 flex-1"
          inputClassName="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
        />
        {value ? <CornerDownLeft className={cn("size-3.5 shrink-0 text-muted-foreground", pending && "animate-pulse")} aria-hidden /> : null}
      </div>
      {parsed.title ? (
        <div id={readBackId} className="flex items-center gap-3 border-t px-3 py-1.5 text-[12px] text-muted-foreground">
          <ReminderTime todo={{ state: "open", reminder: parsed.time ? { time: parsed.time, status: "pending", failure: null, sentAt: null } : null }} />
          <TodoTitle todo={{ title: parsed.title, references, state: "open" }} linked={false} className="min-w-0 flex-1 truncate text-foreground" />
          <span className="shrink-0">{day ? dayLabel(day, today) : "Anytime"}</span>
        </div>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="border-t px-3 py-1.5 text-[12px] text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
