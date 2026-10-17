/**
 * Planned days (`YYYY-MM-DD`) in the Owner timezone. Days are calendar dates, not instants: they are built and
 * formatted at UTC noon, so no local timezone of the server or the browser can shift them.
 */

const atNoon = (day: string) => new Date(`${day}T12:00:00Z`);
const format = (day: string, options: Intl.DateTimeFormatOptions) => atNoon(day).toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** The calendar day an instant falls on in `timeZone`. */
export function dayInZone(instant: Date | string, timeZone: string): string {
  let formatter = dayFormats.get(timeZone);
  if (!formatter) {
    // en-CA formats dates as YYYY-MM-DD.
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormats.set(timeZone, formatter);
  }
  return formatter.format(new Date(instant));
}

export function addDays(day: string, n: number): string {
  const d = atNoon(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 for Sunday to 6 for Saturday. */
export const dayOfWeek = (day: string) => atNoon(day).getUTCDay();

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
