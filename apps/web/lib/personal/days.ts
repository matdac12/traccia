/**
 * Planned days (`YYYY-MM-DD`) in the Owner timezone. Days are calendar dates, not instants: they are built and
 * formatted at UTC noon, so no local timezone of the server or the browser can shift them.
 */

const atNoon = (day: string) => new Date(`${day}T12:00:00Z`);

const formatters = new Map<string, Intl.DateTimeFormat>();
/** One `Intl.DateTimeFormat` per locale and options, built once: every row's labels go through these. */
function formatter(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale} ${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

const format = (day: string, options: Intl.DateTimeFormatOptions) => formatter("en-GB", { ...options, timeZone: "UTC" }).format(atNoon(day));

/** The calendar day an instant falls on in `timeZone`. */
export function dayInZone(instant: Date | string, timeZone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return formatter("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}

/** The wall-clock time (`HH:MM`) an instant shows in `timeZone`. */
export function timeInZone(instant: Date | string, timeZone: string): string {
  return formatter("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
}

/** Now in the Owner timezone: the day and the `HH:MM`. */
export type OwnerNow = { today: string; time: string };

export function ownerNow(timeZone: string, now = new Date()): OwnerNow {
  return { today: dayInZone(now, timeZone), time: timeInZone(now, timeZone) };
}

/**
 * Whether a Reminder at `time` on `day` is no longer in the future, as the API judges it: an earlier day, or today
 * at or before the current minute.
 */
export const isMomentPast = (day: string, time: string, now: OwnerNow) => day < now.today || (day === now.today && time <= now.time);

export function addDays(day: string, n: number): string {
  const d = atNoon(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 for Sunday to 6 for Saturday. */
export const dayOfWeek = (day: string) => atNoon(day).getUTCDay();

/** The coming Monday: a week ahead when `day` is itself a Monday. */
export const nextMonday = (day: string) => addDays(day, (8 - dayOfWeek(day)) % 7 || 7);

/** The first of `day`'s month. */
export const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;

/** The first of the month `n` months from `day`'s. */
export function addMonths(day: string, n: number): string {
  const d = atNoon(firstOfMonth(day));
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** The 42 days (six Monday-first weeks) a month calendar shows for `day`'s month. */
export function monthGrid(day: string): string[] {
  const first = firstOfMonth(day);
  const start = addDays(first, -((dayOfWeek(first) + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** "October 2026". */
export const monthLabel = (day: string) => format(day, { month: "long", year: "numeric" });

/** "Saturday". */
export const weekdayName = (day: string) => format(day, { weekday: "long" });

/** "17 October". */
export const longDate = (day: string) => format(day, { day: "numeric", month: "long" });

/** "Today", "Tomorrow", "Yesterday", else "Thu 15 Oct". */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return format(day, { weekday: "short", day: "numeric", month: "short" });
}
