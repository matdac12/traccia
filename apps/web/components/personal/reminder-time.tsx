import type { Todo } from "@traccia/shared";
import { Bell, BellOff } from "lucide-react";
import { reminderNote } from "@/lib/personal/delivery";
import { cn } from "@/lib/utils";

const STATUS_TEXT = { pending: "Reminder", sent: "Reminder sent", failed: "Reminder failed to send", skipped: "Reminder skipped" } as const;

/** "Reminder sent at 09:00". */
export const reminderLabel = (reminder: NonNullable<Todo["reminder"]>) => `${STATUS_TEXT[reminder.status]} at ${reminder.time}`;

/** The label with why, for a failed or skipped Reminder: "Reminder failed to send at 09:00. Telegram refused it…". */
export function reminderDescription(reminder: NonNullable<Todo["reminder"]>) {
  const note = reminderNote(reminder);
  return note ? `${reminderLabel(reminder)}. ${note}` : reminderLabel(reminder);
}

/**
 * The Reminder time column: monospace, a fixed 44 px so titles line up. Orange while pending, dimmed once sent,
 * skipped or closed, red with a crossed bell when it failed (the tooltip names why). Empty when there is no Reminder.
 */
export function ReminderTime({ todo }: { todo: Pick<Todo, "reminder" | "state"> }) {
  const { reminder } = todo;
  if (!reminder) return <span className="w-11 shrink-0" aria-hidden />;
  const failed = reminder.status === "failed";
  const skipped = reminder.status === "skipped";
  const live = reminder.status === "pending" && todo.state === "open";
  const label = reminderLabel(reminder);
  return (
    <span
      data-status={reminder.status}
      title={reminderDescription(reminder)}
      className={cn(
        "inline-flex w-11 shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums",
        failed ? "text-destructive" : live ? "text-primary" : skipped ? "text-muted-foreground/50" : "text-muted-foreground/70",
      )}
    >
      {failed ? <BellOff className="size-3" aria-hidden /> : <Bell className="size-3" aria-hidden />}
      <span aria-hidden>{reminder.time}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
