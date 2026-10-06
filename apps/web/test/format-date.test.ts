import { describe, expect, it } from "vitest";
import { formatCalendarDate } from "../lib/format-date";

describe("formatCalendarDate", () => {
  it("formats a calendar date from its parts, without a timezone round trip", () => {
    expect(formatCalendarDate("2026-03-09")).toBe("9 Mar 2026");
    expect(formatCalendarDate("2026-12-01")).toBe("1 Dec 2026");
  });
  it("leaves null and non-calendar values unchanged", () => {
    expect(formatCalendarDate(null)).toBeNull();
    expect(formatCalendarDate("")).toBe("");
    expect(formatCalendarDate("2026-3-9")).toBe("2026-3-9");
    expect(formatCalendarDate("not a date")).toBe("not a date");
  });
});
