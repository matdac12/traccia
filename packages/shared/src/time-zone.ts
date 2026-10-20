// The Owner timezone (`OWNER_TIMEZONE`) must be an IANA zone. The API reads it
// as config and the Dashboard validates its own copy of the variable, so both
// use this one check.

/**
 * The canonical IANA name of `zone` (`europe/rome` → `Europe/Rome`), or
 * undefined when it is not one. Bare offsets like `+01:00` are refused: they
 * have no daylight saving, so they never describe where the owner lives.
 */
export function canonicalTimeZone(zone: string): string | undefined {
  if (zone === "" || /^[+-]/.test(zone)) return undefined;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
    }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** True for an IANA zone name `Intl` knows, such as `Europe/Rome`. */
export function isTimeZone(value: string): boolean {
  return canonicalTimeZone(value) !== undefined;
}
