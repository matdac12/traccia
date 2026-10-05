import { ServiceError } from "@linear-matti/shared";

const DURATION =
  /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
const UNIT_MS = [604_800_000, 86_400_000, 3_600_000, 60_000, 1000] as const;

/**
 * `updatedAfter` accepts an ISO 8601 timestamp or a duration like `-P1D`
 * (one day ago), `P2W` or `-PT6H` (a leading `-` is optional: durations always
 * point into the past). Returns a UTC ISO timestamp.
 */
export function resolveUpdatedAfter(value: string, now = new Date()): string {
  const m = DURATION.exec(value.trim());
  if (m && m.slice(2).some((g) => g !== undefined)) {
    const ms = [m[2], m[3], m[4], m[5], m[6]].reduce(
      (sum, g, i) => sum + Number(g ?? 0) * (UNIT_MS[i] ?? 0),
      0,
    );
    return new Date(now.getTime() - ms).toISOString();
  }
  const t = new Date(value);
  if (Number.isNaN(t.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    throw new ServiceError(
      "validation_error",
      `updatedAfter: '${value}' is not an ISO 8601 timestamp (2026-01-31T00:00:00Z) or a duration like -P1D, -PT6H, -P2W`,
    );
  }
  return t.toISOString();
}
