import { describe, expect, it } from "vitest";
import { addDays, dayInZone, dayLabel, longDate, weekdayName } from "../lib/personal/days";
import { isTimeZone } from "../lib/time-zone";

describe("dayInZone", () => {
  it("is the calendar day of an instant in the Owner timezone, not in UTC", () => {
    // 23:30 UTC on 17 Oct is already 18 Oct in Rome (UTC+2), still 17 Oct in New York.
    expect(dayInZone("2026-10-17T23:30:00Z", "Europe/Rome")).toBe("2026-10-18");
    expect(dayInZone("2026-10-17T23:30:00Z", "America/New_York")).toBe("2026-10-17");
    expect(dayInZone(new Date("2026-10-17T21:59:59Z"), "Europe/Rome")).toBe("2026-10-17");
  });

  it("follows the DST change (Rome is UTC+1 after 25 Oct 2026)", () => {
    expect(dayInZone("2026-10-25T22:30:00Z", "Europe/Rome")).toBe("2026-10-25");
    expect(dayInZone("2026-10-25T23:30:00Z", "Europe/Rome")).toBe("2026-10-26");
  });
});

describe("isTimeZone", () => {
  it("accepts IANA zones and refuses the rest", () => {
    expect(isTimeZone("Europe/Rome")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    // Like the API: a bare offset is not a zone.
    expect(isTimeZone("+01:00")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});

describe("addDays", () => {
  it("crosses months, years and DST without drifting", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });
});

describe("day labels", () => {
  it("names the weekday and the long date of a Planned day", () => {
    expect(weekdayName("2026-10-17")).toBe("Saturday");
    expect(longDate("2026-10-17")).toBe("17 October");
  });

  it("says Today, Tomorrow and Yesterday around today, else a short date", () => {
    const today = "2026-10-17";
    expect(dayLabel("2026-10-17", today)).toBe("Today");
    expect(dayLabel("2026-10-18", today)).toBe("Tomorrow");
    expect(dayLabel("2026-10-16", today)).toBe("Yesterday");
    expect(dayLabel("2026-10-15", today)).toBe("Thu 15 Oct");
  });
});
