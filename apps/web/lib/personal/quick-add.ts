import { addDays, dayOfWeek } from "./days";

/** What quick add understood from one line: the title to save, the Planned day and the Reminder time. */
export type QuickAddParse = { title: string; day: string | null; time: string | null };

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** A word of its own: not part of a longer word (`Monica`, `today's`, `sun-cream`) or a Project key (`@MON`). */
const word = (pattern: string) => new RegExp(`(?<![\\p{L}\\p{N}@'’-])(?:${pattern})(?![\\p{L}\\p{N}'’-])`, "giu");

const DAY_WORD = word(`today|oggi|tomorrow|domani|${WEEKDAYS.join("|")}`);

/** `HH:MM` or `H:MM`, 0:00 to 23:59, not part of a longer time (`10:00:00`), range (`9:00-10:00`) or word (`3:15pm`). */
const TIME = /(?<![\p{L}\p{N}@:-])([01]?\d|2[0-3]):([0-5]\d)(?![\p{L}\p{N}:-])/gu;

/** Quick add is typed as "what, then when", so when a day word or time appears twice the last one counts. */
const lastMatch = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].at(-1);

/** The day a day word names: today, tomorrow, or the next such weekday (a week ahead when it is today's). */
function dayFor(w: string, today: string): string {
  if (w === "today" || w === "oggi") return today;
  if (w === "tomorrow" || w === "domani") return addDays(today, 1);
  return addDays(today, (WEEKDAYS.indexOf(w) - dayOfWeek(today) + 7) % 7 || 7);
}

/** `text` without the match; `parseQuickAdd` collapses the space it leaves. */
const withoutMatch = (text: string, m: RegExpMatchArray) => text.slice(0, m.index) + text.slice((m.index ?? 0) + m[0].length);

/**
 * Quick add (docs/personal-space.md §7.5): "call Luca @CRM tomorrow 15:00" → title, Planned day, Reminder time.
 * `@KEY`s stay in the title; the API turns them into Project references.
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
  // A Reminder needs a Planned day; with none typed it is today's, as the API would do.
  if (time && !day) day = today;
  return { title: title.replace(/\s+/g, " ").trim(), day, time };
}
