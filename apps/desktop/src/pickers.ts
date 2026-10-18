import { addDays } from "./days";

/**
 * The composer's Day and Reminder pickers, as pure functions (docs/desktop-app.md §5.4, §5.5). Days are Planned days
 * (`YYYY-MM-DD`), times are `HH:MM`; `today` and `now` are in the Owner timezone, so every "past" check is too.
 */

// ---------- Day picker ----------

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The weekday of a Planned day, 0 for Monday to 6 for Sunday. */
const mondayIndex = (day: string) =>
  (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;

/** The first day of `day`'s month. */
export const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

/** "October 2026", for a month's first day. */
export function monthName(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** The days in `month` (its first day). */
function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The month grid, Monday first: `lead` empty cells, then every day of the month. */
export function monthGrid(month: string): { lead: number; days: string[] } {
  const n = daysInMonth(month);
  return {
    lead: mondayIndex(month),
    days: Array.from({ length: n }, (_, i) => addDays(month, i)),
  };
}

/** The chips' "Next Mon": the next Monday after today, a week ahead when today is one. */
export const nextMonday = (today: string) =>
  addDays(today, 7 - mondayIndex(today));

/** The month `n` months from `month` (a first day). */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/** Paging back stops at the current month (§5.4). */
export const canPageBack = (month: string, today: string) =>
  month > monthOf(today);

/**
 * `cursor`'s day `n` months on, the same date or the month's last, never before today. Paging back from the
 * current month stays put.
 */
export function pageCursor(cursor: string, n: number, today: string): string {
  const month = shiftMonth(monthOf(cursor), n);
  if (month < monthOf(today)) return cursor;
  const date = Math.min(Number(cursor.slice(8, 10)), daysInMonth(month));
  const day = `${month.slice(0, 8)}${String(date).padStart(2, "0")}`;
  return day < today ? today : day;
}

const DAY_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/**
 * The highlighted day after a key in the grid (§5.4): arrows ±1 day and ±1 week, PgUp and PgDn a month, Home today.
 * Never before today. Null for a key the grid doesn't move on.
 */
export function moveDayCursor(
  cursor: string,
  key: string,
  today: string,
): string | null {
  if (key === "Home") return today;
  if (key === "PageUp") return pageCursor(cursor, -1, today);
  if (key === "PageDown") return pageCursor(cursor, 1, today);
  const step = DAY_STEPS[key];
  if (step === undefined) return null;
  const day = addDays(cursor, step);
  return day < today ? today : day;
}

// ---------- Reminder picker ----------

export const toMinutes = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export const fromMinutes = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/** "in 2 h 13 min", "in 45 min", "in 1 h": how far `time` is ahead of `now`. */
export function inText(time: string, now: string): string {
  const d = toMinutes(time) - toMinutes(now);
  const h = Math.floor(d / 60);
  const m = d % 60;
  return `in ${[h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ")}`;
}

/** "9", "930", "9:30", "1430", "14:30", "2pm", "2:15p" → `HH:MM`; anything else → null. */
export function parseTimeInput(raw: string): string | null {
  const m = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\./g, ":")
    .match(/^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    const pm = m[3].startsWith("p");
    h = h === 12 ? (pm ? 12 : 0) : pm ? h + 12 : h;
  }
  return h > 23 || min > 59 ? null : fromMinutes(h * 60 + min);
}

/** A time the Reminder picker offers: `past` ones show but can't be picked. */
export type TimeCandidate = { time: string; past: boolean; hint: string };

/** The note for a past time in the list. */
export const ALREADY_PASSED = "already passed";

/**
 * The Reminder picker's list (§5.5). `onToday` is a draft on today, or on Anytime, which a time moves to today.
 *
 * - Nothing typed: every quarter hour; today only the ones still ahead, each with "in 2 h 13 min".
 * - Typed: that time and its hour's quarter hours. Today, a typed time already behind the clock and before noon
 *   suggests the same time in the evening first (`9` at 14:32 → 21:00).
 * - Typed but unreadable: nothing.
 */
export function timeCandidates({
  query,
  onToday,
  now,
}: {
  query: string;
  onToday: boolean;
  now: string;
}): TimeCandidate[] {
  const isPast = (t: string) => onToday && t <= now;
  let times: string[];
  if (query.trim()) {
    const typed = parseTimeInput(query);
    if (!typed) return [];
    const hour = typed.slice(0, 2);
    times = [typed, ...["00", "15", "30", "45"].map((m) => `${hour}:${m}`)];
    if (isPast(typed) && Number(hour) < 12)
      times.unshift(fromMinutes(toMinutes(typed) + 12 * 60));
    times = [...new Set(times)];
  } else {
    times = Array.from({ length: 96 }, (_, i) => fromMinutes(i * 15)).filter(
      (t) => !isPast(t),
    );
  }
  return times.map((time) => {
    const past = isPast(time);
    return {
      time,
      past,
      hint: past ? ALREADY_PASSED : onToday ? inText(time, now) : "",
    };
  });
}

/**
 * Where the list's highlight starts, -1 for nowhere.
 *
 * - Nothing typed: on the Reminder already set, else the first time today, else 09:00 (the list opens scrolled
 *   there on other days).
 * - Typed: on the first time, the evening suggestion or the typed one, if it can be picked. A typed time already
 *   passed with no evening suggestion highlights nothing, so Enter doesn't swap in another time.
 */
export function startIndex(
  candidates: TimeCandidate[],
  {
    query,
    current,
    onToday,
  }: { query: string; current: string | null; onToday: boolean },
): number {
  if (query.trim()) return candidates[0] && !candidates[0].past ? 0 : -1;
  const set = candidates.findIndex((c) => c.time === current && !c.past);
  if (set >= 0) return set;
  return candidates.findIndex(
    (c) => !c.past && (onToday || c.time === "09:00"),
  );
}

/** The typed time can't be picked: it, and its evening suggestion if any, have already passed today. */
export const typedPassed = (query: string, candidates: TimeCandidate[]) =>
  query.trim() !== "" && candidates[0]?.past === true;

/** ↑ ↓ in the list: the next pickable time that way, skipping past ones; the same index at either end. */
export function moveTimeIndex(
  candidates: TimeCandidate[],
  index: number,
  step: 1 | -1,
): number {
  for (let i = index + step; i >= 0 && i < candidates.length; i += step)
    if (!candidates[i]?.past) return i;
  return index;
}

/** A chip above the list: its words and its time. */
export type TimeChip = { label: string; time: string };

/**
 * The Reminder picker's chips (§5.5). Today: "in 30 min", "in 1 h", "in 2 h" from now (those still today), and
 * "Tonight" 21:00 while that is ahead. Other days: Morning, Lunch, Afternoon and Evening.
 */
export function reminderChips(onToday: boolean, now: string): TimeChip[] {
  if (!onToday)
    return [
      { label: "Morning", time: "09:00" },
      { label: "Lunch", time: "12:30" },
      { label: "Afternoon", time: "15:00" },
      { label: "Evening", time: "18:00" },
    ];
  const chips: TimeChip[] = [
    { label: "in 30 min", minutes: 30 },
    { label: "in 1 h", minutes: 60 },
    { label: "in 2 h", minutes: 120 },
  ]
    .filter(({ minutes }) => toMinutes(now) + minutes < 24 * 60)
    .map(({ label, minutes }) => ({
      label,
      time: fromMinutes(toMinutes(now) + minutes),
    }));
  if ("21:00" > now) chips.push({ label: "Tonight", time: "21:00" });
  return chips;
}
