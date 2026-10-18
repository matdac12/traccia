import {
  type CreateTodoInput,
  parseQuickAdd,
  QUICK_ADD_REMINDER_NEEDS_DAY,
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

/**
 * What the Day and Reminder fields hold apart from the title: `undefined` is "not picked". Picking arrives with the
 * pickers (step 07, TRC-175); until then the composer passes `NOTHING_PICKED`.
 */
export type Picked = { day?: string | null; time?: string | null };

export const NOTHING_PICKED: Picked = {};

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
 * it types `@` on an Italian keyboard).
 */
export function typedCharacter(event: KeyboardEvent): string | null {
  if (event.key.length !== 1 || event.isComposing) return null;
  const altGr = event.getModifierState?.("AltGraph") ?? false;
  if (!altGr && (event.ctrlKey || event.altKey || event.metaKey)) return null;
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
  /** What Enter would add, read from `text` now. */
  draft: Draft;
  /** The red line under the fields: offline, the API's refusal of the last Enter, or the draft's own error. */
  error: string | null;
  /** Changes are off: the title is disabled and Enter sends nothing. */
  disabled: boolean;
  /** Opens it with `initial` typed (the key that opened it). While offline it stays closed and says why. */
  openWith: (initial: string) => boolean;
  close: () => void;
  setText: (text: string) => void;
  /** Enter: posts the draft; on success empties the title for the next one and says where it went. */
  submit: () => void;
};

/**
 * The composer's state (docs/desktop-app.md §5): open or closed, the title line, and the add. It closes when the
 * window hides. `onAdded` gets the To-do as the API created it; `notify` shows a toast.
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
  /** The API's refusal of the last Enter; editing the title clears it. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const busy = useRef(false);
  /** Bumped on every hide: an add sent before it doesn't land on the next show. */
  const showId = useRef(0);
  const latestText = useRef(text);
  latestText.current = text;

  // Step 07 (TRC-175) keeps what the Day and Reminder pickers picked in state here, and passes it as `picked`.
  const draft = composerDraft(text, {
    today: todayIn(ownerTimezone),
    now: clockIn(ownerTimezone),
  });

  const close = () => {
    setOpen(false);
    setTextState("");
    setRefusal(null);
  };

  useEffect(() => {
    if (shown) return;
    showId.current += 1;
    setOpen(false);
    setTextState("");
    setRefusal(null);
  }, [shown]);

  async function submit() {
    if (offline || busy.current) return;
    // Read again at Enter: the clock may have moved past a typed time since the last keystroke.
    const sent = text;
    const now = new Date();
    const today = todayIn(ownerTimezone, now);
    const at = composerDraft(sent, { today, now: clockIn(ownerTimezone, now) });
    if (!canAdd(at)) return;
    const show = showId.current;
    busy.current = true;
    try {
      const result = await client.createTodo(createBody(at));
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
        // Empty for the next one, unless more was typed while it was sent.
        if (latestText.current === sent) setTextState("");
        setRefusal(null);
      } else setRefusal(failureText(result.failure));
    } finally {
      busy.current = false;
    }
  }

  return {
    open,
    text,
    draft,
    error: offline ? OFFLINE_MESSAGE : (refusal ?? draft.error),
    disabled: offline,
    openWith(initial) {
      if (offline) {
        notify(OFFLINE_MESSAGE);
        return false;
      }
      setTextState(initial);
      setRefusal(null);
      setOpen(true);
      return true;
    },
    close,
    setText(next) {
      setTextState(next);
      setRefusal(null);
    },
    submit() {
      void submit();
    },
  };
}
