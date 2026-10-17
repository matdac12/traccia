export const nowIso = (): string => new Date().toISOString();

// Wall-clock helpers for the Owner timezone (`OWNER_TIMEZONE`): a Planned day
// is a `YYYY-MM-DD` and a Reminder an `HH:MM` in that zone, never in UTC.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, f);
  }
  return f;
}

function partsIn(zone: string, instant: Date) {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(zone).formatToParts(instant)) {
    parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** The zone's offset from UTC at `ms`, in milliseconds (east is positive). */
function offsetAt(zone: string, ms: number): number {
  const p = partsIn(zone, new Date(ms));
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/**
 * The canonical IANA name of `zone` (`europe/rome` → `Europe/Rome`), or
 * undefined when it is not one. Bare offsets like `+01:00` are refused: they
 * have no daylight saving, so they never describe where the owner lives.
 */
export function ownerTimeZone(zone: string): string | undefined {
  if (zone === "" || /^[+-]/.test(zone)) return undefined;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
    }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** The day (`YYYY-MM-DD`) and time (`HH:MM`, seconds dropped) of `instant` in `zone`. */
export function wallClockIn(
  zone: string,
  instant: Date,
): { day: string; time: string } {
  const p = partsIn(zone, instant);
  return {
    day: `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/** Today's date (`YYYY-MM-DD`) in `zone`. */
export function todayIn(zone: string, now: Date = new Date()): string {
  return wallClockIn(zone, now).day;
}

/**
 * The instant at which `day` (`YYYY-MM-DD`) and `time` (`HH:MM`) happen in
 * `zone`. A time that happens twice (the hour repeated when summer time ends)
 * is its first occurrence; a time skipped when summer time starts reads with
 * the offset before the change, so it lands that much later (02:30 → 03:30).
 */
export function instantIn(zone: string, day: string, time: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const local = Date.UTC(y, m - 1, d, h, mi);
  // A wall-clock time is at most a day away from its instant, and offsets
  // change at most once in that window: the offsets either side are the only
  // candidates.
  const DAY = 86_400_000;
  const before = local - offsetAt(zone, local - DAY);
  const after = local - offsetAt(zone, local + DAY);
  const valid = [before, after].filter((t) => t + offsetAt(zone, t) === local);
  return new Date(valid.length ? Math.min(...valid) : before);
}
