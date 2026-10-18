import {
  type CreateTodoInput,
  parseQuickAdd,
  QUICK_ADD_REMINDER_NEEDS_DAY,
  withoutQuickAddWords,
} from "@traccia/shared";
import { useEffect, useRef, useState } from "react";
import type { ApiClient, ApiFailure, Todo } from "./api-client";
import { addDays, clockIn, dayLabel, todayIn } from "./days";
import { OFFLINE_MESSAGE } from "./row-actions";

/**
 * What the composer will add (docs/desktop-app.md §5.2, §5.3): the title line read with the shared quick-add rules,
 * then the Day and Reminder fields. A day or time typed in the title wins; otherwise the picked value; otherwise
 * Today and no Reminder.
 */
export type Draft = {
  /** The title to send: the line without its day word and time, `@KEY`s kept. */
  title: string;
  /** The Planned day, `YYYY-MM-DD`, or null for Anytime. */
  day: string | null;
  /** The Reminder time, `HH:MM`, or null. */
  time: string | null;
  /** The title names the day or the time: its field shows a "typed" tag. */
  dayTyped: boolean;
  timeTyped: boolean;
  /** Why it can't be added as it is; nothing is sent while there is one. */
  error: string | null;
};

/** What the Day and Reminder pickers picked, apart from the title: `undefined` is "not picked". */
export type Picked = { day?: string | null; time?: string | null };

export const NOTHING_PICKED: Picked = {};

/** The title line and what the pickers picked: the composer's whole state for the draft. */
export type Picking = { text: string; picked: Picked };

/**
 * Picking a day (§5.3): the title loses its day words, so the picked day is the one used. Anytime also removes the
 * Reminder, typed or picked: only a To-do with a Planned day can have one.
 */
export function pickDay(
  { text, picked }: Picking,
  day: string | null,
): Picking {
  const next = withoutQuickAddWords(text, "day");
  return day === null
    ? { text: withoutQuickAddWords(next, "time"), picked: { day, time: null } }
    : { text: next, picked: { ...picked, day } };
}

/**
 * Picking a time, or null to remove the Reminder (§5.3): the title loses its times. A time on Anytime moves the day
 * to today, the title losing its `anytime`.
 */
export function pickTime(
  { text, picked }: Picking,
  time: string | null,
  today: string,
): Picking {
  const next: Picking = {
    text: withoutQuickAddWords(text, "time"),
    picked: { ...picked, time },
  };
  if (time === null) return next;
  const { day } = composerDraft(next.text, {
    today,
    now: "00:00",
    picked: next.picked,
  });
  return day === null
    ? {
        text: withoutQuickAddWords(next.text, "day"),
        picked: { day: today, time },
      }
    : next;
}

/** The Reminder picker counts past times as today's: a draft on today, or on Anytime, which a time moves to today. */
export const timeOnToday = (draft: Draft, today: string) =>
  draft.day === null || draft.day === today;

/** The composer's own check of a Reminder already behind the clock, as the Dashboard's Reminder picker words it. */
export const TIME_PASSED = "That time has already passed.";

/**
 * Reads the title line. `today` and `now` (`HH:MM`) are in the Owner timezone. The past-time check mirrors the API's
 * refusal (a Reminder must be ahead of now), so Enter sends nothing the API would refuse for it; the API still has
 * the last word.
 */
export function composerDraft(
  text: string,
  {
    today,
    now,
    picked = NOTHING_PICKED,
  }: { today: string; now: string; picked?: Picked },
): Draft {
  const parsed = parseQuickAdd(text, today);
  const day = parsed.dayTyped
    ? parsed.day
    : picked.day !== undefined
      ? picked.day
      : today;
  const time = parsed.timeTyped ? parsed.time : (picked.time ?? null);
  let error = parsed.error;
  if (!error && time && day === null) error = QUICK_ADD_REMINDER_NEEDS_DAY;
  if (!error && time && day === today && time <= now) error = TIME_PASSED;
  return {
    title: parsed.title,
    day,
    time,
    dayTyped: parsed.dayTyped,
    timeTyped: parsed.timeTyped,
    error,
  };
}

/** Enter adds it: a title, and no error. */
export const canAdd = (draft: Draft) =>
  draft.title !== "" && draft.error === null;

/** `POST /v1/todos { title, day?, time? }`, with no `day` for Anytime (§5.6). */
export function createBody(draft: Draft): CreateTodoInput {
  return {
    title: draft.title,
    ...(draft.day !== null && { day: draft.day }),
    ...(draft.time !== null && { time: draft.time }),
  };
}

/** The Day field and the toast: "Today", "Tomorrow", "Tue 20 Oct" or "Anytime". */
export function dayName(day: string | null, today: string): string {
  if (day === null) return "Anytime";
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  return dayLabel(day, "full");
}

/** The toast after an add: "Added to Tue 20 Oct · Reminder 18:00". */
export function addedText(
  added: { day: string | null; time: string | null },
  today: string,
): string {
  const where = `Added to ${dayName(added.day, today)}`;
  return added.time ? `${where} · Reminder ${added.time}` : where;
}

/**
 * A key that opens the composer from the list (§5.1): a character, typed with no Ctrl, Alt or Meta (AltGr is fine:
 * it types `@` on an Italian keyboard). Ctrl+Alt counts as AltGr, as Windows treats them: `[` (AltGr+è) can arrive
 * with both and no AltGraph state.
 */
export function typedCharacter(event: KeyboardEvent): string | null {
  if (event.key.length !== 1 || event.isComposing || event.metaKey) return null;
  const altGr =
    (event.getModifierState?.("AltGraph") ?? false) ||
    (event.ctrlKey && event.altKey);
  if (!altGr && (event.ctrlKey || event.altKey)) return null;
  return event.key;
}

/** What a refused add says under the fields (§5.6): the API's own message, or why it couldn't be sent. */
function failureText(failure: ApiFailure): string {
  return failure.kind === "offline" ? OFFLINE_MESSAGE : failure.message;
}

type ComposerClient = Pick<ApiClient, "createTodo">;

export type Composer = {
  open: boolean;
  /** The title line as typed. */
  text: string;
  /** What Enter would add, read from `text` and what was picked, now. */
  draft: Draft;
  /** Today and the clock (`HH:MM`) in the Owner timezone, as the draft was read. */
  today: string;
  now: string;
  /** The red line under the fields: offline, the API's refusal of the last Enter, or the draft's own error. */
  error: string | null;
  /** Changes are off: the title is disabled and Enter sends nothing. */
  disabled: boolean;
  /** Opens it with `initial` typed (the key that opened it). While offline it stays closed and says why. */
  openWith: (initial: string) => boolean;
  close: () => void;
  setText: (text: string) => void;
  /** The Day picker's pick: a Planned day, or null for Anytime (§5.3). */
  pickDay: (day: string | null) => void;
  /** The Reminder picker's pick: a time, or null for "Remove Reminder" (§5.3). */
  pickTime: (time: string | null) => void;
  /** Enter: posts the draft; on success empties the title for the next one and says where it went. */
  submit: () => void;
};

/**
 * The composer's state (docs/desktop-app.md §5): open or closed, the title line, what the pickers picked, and the
 * add. It closes when the window hides. `onAdded` gets the To-do as the API created it; `notify` shows a toast.
 */
export function useComposer(
  client: ComposerClient,
  {
    ownerTimezone,
    shown,
    offline,
    onAdded,
    notify,
  }: {
    ownerTimezone: string;
    shown: boolean;
    offline: boolean;
    onAdded: (todo: Todo) => void;
    notify: (text: string) => void;
  },
): Composer {
  const [open, setOpen] = useState(false);
  const [text, setTextState] = useState("");
  const [picked, setPicked] = useState<Picked>(NOTHING_PICKED);
  /** The API's refusal of the last Enter; editing the title or picking clears it. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const busy = useRef(false);
  /** Bumped on every hide: an add sent before it doesn't land on the next show. */
  const showId = useRef(0);
  const latest = useRef<Picking>({ text, picked });
  latest.current = { text, picked };

  const today = todayIn(ownerTimezone);
  const now = clockIn(ownerTimezone);
  const draft = composerDraft(text, { today, now, picked });

  const reset = () => {
    setTextState("");
    setPicked(NOTHING_PICKED);
    setRefusal(null);
  };
  const close = () => {
    setOpen(false);
    reset();
  };
  const apply = (next: Picking) => {
    setTextState(next.text);
    setPicked(next.picked);
    setRefusal(null);
  };

  useEffect(() => {
    if (shown) return;
    showId.current += 1;
    setOpen(false);
    setTextState("");
    setPicked(NOTHING_PICKED);
    setRefusal(null);
  }, [shown]);

  async function submit() {
    if (offline || busy.current) return;
    // Read again at Enter: the clock may have moved past a typed time since the last keystroke.
    const sent = latest.current;
    const at = new Date();
    const today = todayIn(ownerTimezone, at);
    const ready = composerDraft(sent.text, {
      today,
      now: clockIn(ownerTimezone, at),
      picked: sent.picked,
    });
    if (!canAdd(ready)) return;
    const show = showId.current;
    busy.current = true;
    try {
      const result = await client.createTodo(createBody(ready));
      if (show !== showId.current) return;
      if (result.ok) {
        const todo = result.value;
        onAdded(todo);
        notify(
          addedText(
            { day: todo.day, time: todo.reminder?.time ?? null },
            today,
          ),
        );
        // Empty for the next one, unless more was typed or picked while it was sent.
        const { text, picked } = latest.current;
        if (text === sent.text && picked === sent.picked) reset();
        else setRefusal(null);
      } else setRefusal(failureText(result.failure));
    } finally {
      busy.current = false;
    }
  }

  return {
    open,
    text,
    draft,
    today,
    now,
    error: offline ? OFFLINE_MESSAGE : (refusal ?? draft.error),
    disabled: offline,
    openWith(initial) {
      if (offline) {
        notify(OFFLINE_MESSAGE);
        return false;
      }
      reset();
      setTextState(initial);
      setOpen(true);
      return true;
    },
    close,
    setText(next) {
      setTextState(next);
      setRefusal(null);
    },
    pickDay(day) {
      apply(pickDay(latest.current, day));
    },
    pickTime(time) {
      apply(pickTime(latest.current, time, todayIn(ownerTimezone)));
    },
    submit() {
      void submit();
    },
  };
}
