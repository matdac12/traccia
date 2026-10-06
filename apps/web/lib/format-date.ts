const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A calendar date (`2026-03-09`) as `9 Mar 2026`. Formatted from the parts, not through `new Date()`, so there is no
 * timezone round trip (which would shift the day in some zones). A null or non-calendar value is returned unchanged.
 */
export function formatCalendarDate(date: string | null): string | null {
  const m = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) return date;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
