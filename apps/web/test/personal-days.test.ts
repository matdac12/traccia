import { describe, expect, it } from "vitest";
import { addDays, addMonths, dayInZone, dayLabel, isMomentPast, longDate, monthGrid, monthLabel, nextMonday, timeInZone, weekdayName } from "../lib/personal/days";
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

describe("timeInZone", () => {
  it("is the wall-clock HH:MM of an instant in the Owner timezone", () => {
    expect(timeInZone("2026-10-17T13:05:40Z", "Europe/Rome")).toBe("15:05");
    expect(timeInZone("2026-10-17T22:30:00Z", "Europe/Rome")).toBe("00:30");
    expect(timeInZone("2026-10-17T13:05:00Z", "America/New_York")).toBe("09:05");
  });
});

describe("isMomentPast", () => {
  it("refuses an earlier day, or today at or before the current minute, like the API", () => {
    const now = { today: "2026-10-17", time: "15:00" };
    expect(isMomentPast("2026-10-16", "23:59", now)).toBe(true);
    expect(isMomentPast("2026-10-17", "14:59", now)).toBe(true);
    expect(isMomentPast("2026-10-17", "15:00", now)).toBe(true);
    expect(isMomentPast("2026-10-17", "15:01", now)).toBe(false);
    expect(isMomentPast("2026-10-18", "08:00", now)).toBe(false);
  });
});

describe("nextMonday", () => {
  it("is the coming Monday, a week ahead when today is a Monday", () => {
    expect(nextMonday("2026-10-17")).toBe("2026-10-19"); // Saturday
    expect(nextMonday("2026-10-18")).toBe("2026-10-19"); // Sunday
    expect(nextMonday("2026-10-19")).toBe("2026-10-26"); // Monday
  });
});

describe("month grid", () => {
  it("shows six Monday-first weeks around the month", () => {
    const grid = monthGrid("2026-10-17");
    expect(grid).toHaveLength(42);
    // 1 Oct 2026 is a Thursday, so the grid opens on Monday 28 Sep.
    expect(grid[0]).toBe("2026-09-28");
    expect(grid[3]).toBe("2026-10-01");
    expect(grid[41]).toBe("2026-11-08");
  });

  it("steps whole months from the first and names them", () => {
    expect(addMonths("2026-10-31", 1)).toBe("2026-11-01");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
    expect(monthLabel("2026-10-17")).toBe("October 2026");
  });
});
