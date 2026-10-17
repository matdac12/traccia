// PROTOTYPE (TRC-148): throwaway seed data and helpers for the Personal Space variants. In-memory only.

export type TodoState = "open" | "done" | "dropped";
export type ReminderStatus = "pending" | "sent" | "failed";

export type Todo = {
  id: string;
  title: string;
  /** Planned day, YYYY-MM-DD in the owner timezone, or null for Anytime. */
  day: string | null;
  /** Reminder time of day (HH:MM) on the Planned day, or null. */
  time: string | null;
  reminder: ReminderStatus | null;
  state: TodoState;
  parentId: string | null;
  /** Position within its day (or Anytime). */
  position: number;
  details?: string;
  /** Name of the token that created it. */
  source: "dashboard" | "parla";
  closedOn?: string;
};

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function addDays(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  return iso(new Date(y, m - 1, d + n));
}

export const toDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export function dayLabel(day: string, today: string) {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return toDate(day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export const weekday = (day: string) => toDate(day).toLocaleDateString("en-GB", { weekday: "long" });
export const longDate = (day: string) => toDate(day).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

let n = 0;
const id = () => `t${++n}`;

/** About 30 realistic To-dos around `today`, drawn from the owner's real Projects and life. */
export function seed(today: string): Todo[] {
  n = 0;
  const d = (k: number) => addDays(today, k);
  const t = (title: string, day: string | null, extra: Partial<Todo> = {}): Todo => ({
    id: id(),
    title,
    day,
    time: null,
    reminder: null,
    state: "open",
    parentId: null,
    position: 0,
    source: "dashboard",
    ...extra,
  });
  const kitchen = t("Renovate the kitchen", null, { details: "Budget about 12k. Keep the old sink." });
  const list: Todo[] = [
    // Overdue
    t("Send the revised quote to @CIT", d(-2)),
    t("Renew the car insurance", d(-1), { time: "09:00", reminder: "sent", details: "Policy 88-1204, compare with the broker's offer first." }),
    // Today
    t("Work on @CRM UI polish", d(0)),
    t("Review the @PARLA command mode PR", d(0)),
    t("Call the bank about the mortgage", d(0), { time: "15:00", reminder: "pending", details: "Ask for Rossi, ref 4471." }),
    t("Chiamare Luca", d(0), { time: "18:30", reminder: "pending", source: "parla" }),
    t("Gym: legs", d(0)),
    t("Pay the electricity bill", d(0), { state: "done", closedOn: d(0) }),
    // Tomorrow and the days after
    t("Lunch with mum", d(1), { time: "12:30", reminder: "pending" }),
    t("Write the @TRC Personal Space spec", d(1)),
    t("Dentist, Via Roma 12", d(2), { time: "10:00", reminder: "pending", source: "parla" }),
    t("Prep the @PUB editorial meeting", d(3)),
    t("Ritirare il pacco in posta", d(3), { time: "17:00", reminder: "failed", source: "parla" }),
    t("Test the new tracking model @BBVA", d(5)),
    t("Weekly review", d(6)),
    t("Pay the @PEC renewal and check @CRM invoices", d(8)),
    // Anytime
    kitchen,
    t("Read Shape Up", null),
    t("Fix the bike brakes", null),
    t("Book the summer holiday", null),
    t("Think about the @CAD pricing page", null),
    t("Sort the receipts for the 730", null),
    t("Check the @CMR export", null, { details: "Typo on purpose: @CMR is not a Project, so it stays plain text." }),
    // Logbook
    t("Send the @CIT kickoff deck", d(-1), { state: "done", closedOn: d(-1) }),
    t("Pick up the dry cleaning", d(-1), { state: "dropped", closedOn: d(-1) }),
    t("Fix the @PARLA hotkey bug", d(-2), { state: "done", closedOn: d(-2) }),
    t("Buy a birthday present for Giulia", d(-3), { state: "done", closedOn: d(-3), time: "11:00", reminder: "sent" }),
    t("Call the plumber", d(-4), { state: "dropped", closedOn: d(-4) }),
  ];
  list.push(
    t("Get three quotes", null, { parentId: kitchen.id, state: "done", closedOn: d(-2) }),
    t("Call the electrician", d(1), { parentId: kitchen.id, time: "09:30", reminder: "pending" }),
    t("Pick the tiles @HOME", d(4), { parentId: kitchen.id }),
    t("Choose the worktop", null, { parentId: kitchen.id }),
  );
  // Positions in creation order within each bucket.
  const pos = new Map<string, number>();
  for (const x of list) {
    const k = `${x.parentId ?? ""}|${x.day ?? "anytime"}`;
    x.position = pos.get(k) ?? 0;
    pos.set(k, x.position + 1);
  }
  return list;
}

export type Segment = { text: string } | { key: string; raw: string };

/** Project references: `@KEY` naming an existing Project (case-insensitive); anything else stays text. */
export function parseRefs(title: string, keys: Set<string>): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of title.matchAll(/@([A-Za-z][A-Za-z0-9]{1,7})\b/g)) {
    const key = m[1].toUpperCase();
    if (!keys.has(key)) continue;
    if (m.index > last) out.push({ text: title.slice(last, m.index) });
    out.push({ key, raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < title.length) out.push({ text: title.slice(last) });
  return out;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Quick add: "call Luca @CRM tomorrow 15:00" → title, Planned day, Reminder time. */
export function parseQuickAdd(input: string, today: string) {
  let title = input;
  let day: string | null = null;
  let time: string | null = null;
  const tm = title.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (tm) {
    time = `${tm[1].padStart(2, "0")}:${tm[2]}`;
    title = title.replace(tm[0], "");
  }
  const dm = title.match(/\b(today|oggi|tomorrow|domani|mon|tue|wed|thu|fri|sat|sun)\b/i);
  if (dm) {
    const w = dm[1].toLowerCase();
    if (w === "today" || w === "oggi") day = today;
    else if (w === "tomorrow" || w === "domani") day = addDays(today, 1);
    else {
      const target = DAYS.indexOf(w);
      const cur = toDate(today).getDay();
      day = addDays(today, ((target - cur + 7) % 7) || 7);
    }
    title = title.replace(dm[0], "");
  }
  if (time && !day) day = today;
  return { title: title.replace(/\s{2,}/g, " ").trim(), day, time };
}
