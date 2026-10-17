/**
 * True for an IANA zone name `Intl` knows, such as `Europe/Rome`. Bare offsets like `+01:00` are refused, as the API
 * refuses them for the same `OWNER_TIMEZONE` (`apps/api/src/time.ts`).
 */
export function isTimeZone(value: string): boolean {
  if (value === "" || /^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
