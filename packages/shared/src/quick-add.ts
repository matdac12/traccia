// Quick add (docs/personal-space.md §7.5, docs/desktop-app.md §5.2): one typed
// line read as a To-do's title, Planned day and Reminder time. Shared by the
// Dashboard's quick add and the Desktop composer. Pure: "today" is passed in,
// already in the Owner timezone.

/**
 * What quick add understood from one line.
 *
 * - `title`: the line without the day word and time it used, spaces collapsed.
 *   `@KEY`s stay in it; the API turns them into Project references.
 * - `day`: the Planned day (`YYYY-MM-DD`), or null. Null is Anytime when
 *   `dayTyped` (the line says `anytime`), and "none typed" otherwise. A time
 *   with no day word puts it on today, with `dayTyped` false.
 * - `time`: the Reminder time (`HH:MM`), or null.
 * - `dayTyped` / `timeTyped`: whether the line itself names the day / time, so
 *   a composer can tell typed values from its own defaults.
 * - `error`: why the line can't be added as typed, or null. Today only
 *   `anytime` with a time: a Reminder needs a Planned day.
 */
export type QuickAddParse = {
  title: string;
  day: string | null;
  time: string | null;
  dayTyped: boolean;
  timeTyped: boolean;
  error: string | null;
};

/** `QuickAddParse.error` for `anytime` with a time. */
export const QUICK_ADD_REMINDER_NEEDS_DAY =
  "A Reminder needs a Planned day: remove anytime or the time.";

/** Weekday words (English and Italian, short and full, with and without the accent) → `Date.getUTCDay()` (0 = Sunday). */
const WEEKDAYS: Record<string, number> = Object.fromEntries(
  [
    ["sun", "sunday", "dom", "domenica"],
    ["mon", "monday", "lun", "lunedì", "lunedi"],
    ["tue", "tuesday", "mar", "martedì", "martedi"],
    ["wed", "wednesday", "mer", "mercoledì", "mercoledi"],
    ["thu", "thursday", "gio", "giovedì", "giovedi"],
    ["fri", "friday", "ven", "venerdì", "venerdi"],
    ["sat", "saturday", "sab", "sabato"],
  ].flatMap((words, index) => words.map((w) => [w, index] as const)),
);

/** A word of its own: not part of a longer word (`Monica`, `today's`, `sun-cream`) or a Project key (`@MON`). */
const word = (pattern: string) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}@'’-])(?:${pattern})(?![\\p{L}\\p{N}'’-])`,
    "giu",
  );

const DAY_WORD = word(
  `today|oggi|tomorrow|domani|anytime|${Object.keys(WEEKDAYS).join("|")}`,
);

/** `HH:MM` or `H:MM`, 0:00 to 23:59, not part of a longer time (`10:00:00`), range (`9:00-10:00`) or word (`3:15pm`). */
const TIME =
  /(?<![\p{L}\p{N}@:-])([01]?\d|2[0-3]):([0-5]\d)(?![\p{L}\p{N}:-])/gu;

/** Quick add is typed as "what, then when", so when a day word or time appears twice the last one counts. */
const lastMatch = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].at(-1);

/** Planned days are calendar dates: computed at UTC noon so no local timezone can shift them. */
const atNoon = (day: string) => new Date(`${day}T12:00:00Z`);

function addDays(day: string, n: number): string {
  const d = atNoon(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The day a day word names: today, tomorrow, the next such weekday (a week ahead when it is today's), or null for anytime. */
function dayFor(w: string, today: string): string | null {
  if (w === "anytime") return null;
  if (w === "today" || w === "oggi") return today;
  if (w === "tomorrow" || w === "domani") return addDays(today, 1);
  const weekday = atNoon(today).getUTCDay();
  return addDays(today, ((WEEKDAYS[w] as number) - weekday + 7) % 7 || 7);
}

/** `text` without the match; `parseQuickAdd` collapses the space it leaves. */
const withoutMatch = (text: string, m: RegExpMatchArray) =>
  text.slice(0, m.index) + text.slice((m.index ?? 0) + m[0].length);

/**
 * Quick add: "call Luca @CRM tomorrow 15:00" → title, Planned day, Reminder
 * time. Day words: today/oggi, tomorrow/domani, a weekday, English or Italian, short or full (mon/monday, lun/lunedì…: the next such day)
 * and anytime (no Planned day); times: `HH:MM`. `today` is today's date in the
 * Owner timezone.
 */
export function parseQuickAdd(input: string, today: string): QuickAddParse {
  let title = input;
  let day: string | null = null;
  let time: string | null = null;
  const timeMatch = lastMatch(title, TIME);
  if (timeMatch) {
    time = `${(timeMatch[1] as string).padStart(2, "0")}:${timeMatch[2]}`;
    title = withoutMatch(title, timeMatch);
  }
  const dayMatch = lastMatch(title, DAY_WORD);
  if (dayMatch) {
    day = dayFor(dayMatch[0].toLowerCase(), today);
    title = withoutMatch(title, dayMatch);
  }
  const dayTyped = dayMatch !== undefined;
  // A Reminder needs a Planned day; with none typed it is today's, as the API would do.
  if (time && !dayTyped) day = today;
  return {
    title: title.replace(/\s+/g, " ").trim(),
    day,
    time,
    dayTyped,
    timeTyped: timeMatch !== undefined,
    error: time && dayTyped && !day ? QUICK_ADD_REMINDER_NEEDS_DAY : null,
  };
}

/**
 * `input` without every day word (`kind` "day", `anytime` included) or every `HH:MM` time ("time"), spaces
 * collapsed. A composer calls it when a value is picked in its Day or Reminder field (docs/desktop-app.md §5.3):
 * the line then names no day (or time) of its own, so the picked one is used and the title stays clean.
 */
export function withoutQuickAddWords(
  input: string,
  kind: "day" | "time",
): string {
  return input
    .replace(kind === "day" ? DAY_WORD : TIME, " ")
    .replace(/\s+/g, " ")
    .trim();
}
