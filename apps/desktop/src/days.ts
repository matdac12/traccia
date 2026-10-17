/**
 * Days and clock times in the Owner timezone (docs/desktop-app.md §6), never the laptop's zone. Planned days are
 * `YYYY-MM-DD` strings, compared as text.
 */

function parts(
  timeZone: string,
  now: Date,
  options: Intl.DateTimeFormatOptions,
) {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", {
    timeZone,
    ...options,
  }).formatToParts(now)) {
    out[p.type] = p.value;
  }
  return out;
}

/** Today's date, `YYYY-MM-DD`, in `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const p = parts(timeZone, now, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return `${p.year}-${p.month}-${p.day}`;
}

/** The clock time, `HH:MM`, in `timeZone`. */
export function clockIn(timeZone: string, now: Date = new Date()): string {
  const p = parts(timeZone, now, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${p.hour}:${p.minute}`;
}

/** A Planned day as noon UTC, so its weekday and date never shift with a zone. */
const noonUtc = (day: string) => new Date(`${day}T12:00:00Z`);

/** `day` plus `n` days. */
export function addDays(day: string, n: number): string {
  const date = noonUtc(day);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** "Thu 15" (`weekday`, for Overdue rows) or "Mon 19 Oct" (`full`, for headings). */
export function dayLabel(day: string, form: "weekday" | "full"): string {
  const p = parts("UTC", noonUtc(day), {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return form === "weekday"
    ? `${p.weekday} ${p.day}`
    : `${p.weekday} ${p.day} ${p.month}`;
}
