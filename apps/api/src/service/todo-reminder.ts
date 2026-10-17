import { ServiceError } from "@traccia/shared";
import type { todos } from "../db/schema.js";
import { instantIn, todayIn, wallClockIn } from "../time.js";

// Reminder rules for To-dos (docs/personal-space.md §2 rule 5, §4): where a
// Reminder is armed, re-armed, removed and skipped. Pure functions over a To-do
// row's columns, so create and update share them; nothing here sends anything.

type Row = typeof todos.$inferSelect;
type Columns = Pick<
  Row,
  | "reminderTime"
  | "reminderStatus"
  | "reminderSentAt"
  | "reminderAttempts"
  | "reminderNextAttemptAt"
  | "reminderFailure"
>;

/** What a To-do without a Reminder holds in the `reminder_*` columns. */
const NO_REMINDER: Columns = {
  reminderTime: null,
  reminderStatus: null,
  reminderSentAt: null,
  reminderAttempts: 0,
  reminderNextAttemptAt: null,
  reminderFailure: null,
};

/** A Reminder at `time`, waiting to be sent: also what re-arming does. */
const armed = (time: string): Columns => ({
  ...NO_REMINDER,
  reminderTime: time,
  reminderStatus: "pending",
});

function invalid(field: string, message: string): ServiceError {
  return new ServiceError("validation_error", `${field} ${message}`, {
    fields: { [field]: [`${field} ${message}`] },
  });
}

/** The moment of a Reminder must still be ahead of `now`. */
function requireFuture(
  zone: string,
  day: string,
  time: string,
  now: Date,
  field: string,
): void {
  if (instantIn(zone, day, time).getTime() > now.getTime()) return;
  throw invalid(
    field,
    `must be in the future (${day} ${time} in ${zone} has passed)`,
  );
}

/**
 * The Planned day and Reminder a new To-do starts with. `remindAt` sets both
 * (and `day`, when sent too, must agree); `time` sits on `day`, or on today.
 */
export function newSchedule(
  input: { day?: string | null; time?: string; remindAt?: string },
  zone: string,
  now: Date,
): { day: string | null; reminder: Columns } {
  if (input.remindAt !== undefined) {
    const moment = wallClockIn(zone, new Date(input.remindAt));
    if (input.day !== undefined && input.day !== moment.day) {
      throw invalid(
        "day",
        `must be ${moment.day}, the day of remindAt in ${zone}, or omitted`,
      );
    }
    requireFuture(zone, moment.day, moment.time, now, "remindAt");
    return { day: moment.day, reminder: armed(moment.time) };
  }
  const day = input.day ?? null;
  if (input.time === undefined) return { day, reminder: NO_REMINDER };
  const reminderDay = day ?? todayIn(zone, now);
  requireFuture(zone, reminderDay, input.time, now, "time");
  return { day: reminderDay, reminder: armed(input.time) };
}

/**
 * What a patch of `day` and `time` does to a To-do's day and Reminder.
 * `reminder` is undefined when the Reminder columns stay as they are.
 *
 * - `day: null` or `time: null` removes the Reminder.
 * - `time` on an undated To-do puts it on today.
 * - A changed moment (the day moved, or a different time) must be in the
 *   future, and re-arms the Reminder even if it was sent. The same moment
 *   changes nothing and isn't checked, so editing a past To-do stays possible.
 */
export function updatedSchedule(
  todo: Pick<Row, "day" | "reminderTime">,
  patch: { day?: string | null; time?: string | null },
  zone: string,
  now: Date,
): { day: string | null; reminder: Columns | undefined } {
  const removal = patch.day === null || patch.time === null;
  if (removal) {
    return {
      day: patch.day === undefined ? todo.day : patch.day,
      reminder: todo.reminderTime === null ? undefined : NO_REMINDER,
    };
  }
  const time = patch.time ?? todo.reminderTime;
  const day = patch.day ?? todo.day;
  if (time === null) return { day, reminder: undefined };

  const reminderDay = day ?? todayIn(zone, now);
  if (reminderDay === todo.day && time === todo.reminderTime) {
    return { day, reminder: undefined };
  }
  requireFuture(
    zone,
    reminderDay,
    time,
    now,
    patch.time === undefined ? "day" : "time",
  );
  return { day: reminderDay, reminder: armed(time) };
}

/**
 * Reopening a To-do: a pending Reminder whose moment has passed is `skipped`,
 * so it never goes out late. Returns the columns to change, if any. Sent,
 * failed and skipped Reminders are left as they are.
 */
export function skippedOnReopen(
  todo: Pick<Row, "day" | "reminderTime" | "reminderStatus">,
  zone: string,
  now: Date,
): Pick<Columns, "reminderStatus" | "reminderNextAttemptAt"> | undefined {
  if (
    todo.day === null ||
    todo.reminderTime === null ||
    todo.reminderStatus !== "pending"
  ) {
    return undefined;
  }
  if (instantIn(zone, todo.day, todo.reminderTime).getTime() > now.getTime()) {
    return undefined;
  }
  return { reminderStatus: "skipped", reminderNextAttemptAt: null };
}
