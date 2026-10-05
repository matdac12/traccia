import type { Milestone } from "@/lib/api/schemas";

/** Share of done issues, 0-100 (canceled issues are already excluded from the API's `total`). */
export function progressPercent(progress: Milestone["progress"]): number {
  if (!progress || progress.total === 0) return 0;
  return Math.round((progress.done / progress.total) * 100);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-03-09` to `9 Mar 2026`; calendar dates are formatted without a timezone round trip. */
export function formatTargetDate(date: string | null): string | null {
  const m = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) return date;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
