import { describe, expect, it } from "vitest";
import { clockIn, dayLabel, todayIn } from "../src/days";

const at = (iso: string) => new Date(iso);

describe("todayIn the Owner timezone", () => {
  it("turns at midnight in Europe/Rome, not at midnight UTC or on the laptop", () => {
    // Sat 17 Oct 2026 is summer time in Rome (UTC+2).
    expect(todayIn("Europe/Rome", at("2026-10-17T21:59:59Z"))).toBe(
      "2026-10-17",
    );
    expect(todayIn("Europe/Rome", at("2026-10-17T22:00:00Z"))).toBe(
      "2026-10-18",
    );
    expect(todayIn("UTC", at("2026-10-17T22:00:00Z"))).toBe("2026-10-17");
  });

  it("keeps the 25-hour day of the October change as one day", () => {
    // Sun 25 Oct 2026: 03:00 summer time becomes 02:00 winter time (at 01:00 UTC).
    expect(todayIn("Europe/Rome", at("2026-10-24T21:59:59Z"))).toBe(
      "2026-10-24",
    );
    expect(todayIn("Europe/Rome", at("2026-10-24T22:00:00Z"))).toBe(
      "2026-10-25",
    );
    // 02:30 happens twice that night; both are the 25th.
    expect(todayIn("Europe/Rome", at("2026-10-25T00:30:00Z"))).toBe(
      "2026-10-25",
    );
    expect(todayIn("Europe/Rome", at("2026-10-25T01:30:00Z"))).toBe(
      "2026-10-25",
    );
    // After the change, midnight is at 23:00 UTC.
    expect(todayIn("Europe/Rome", at("2026-10-25T22:59:59Z"))).toBe(
      "2026-10-25",
    );
    expect(todayIn("Europe/Rome", at("2026-10-25T23:00:00Z"))).toBe(
      "2026-10-26",
    );
  });

  it("keeps the 23-hour day of the March change as one day", () => {
    // Sun 29 Mar 2026: 02:00 winter time becomes 03:00 summer time.
    expect(todayIn("Europe/Rome", at("2026-03-28T22:59:59Z"))).toBe(
      "2026-03-28",
    );
    expect(todayIn("Europe/Rome", at("2026-03-28T23:00:00Z"))).toBe(
      "2026-03-29",
    );
    expect(todayIn("Europe/Rome", at("2026-03-29T21:59:59Z"))).toBe(
      "2026-03-29",
    );
    expect(todayIn("Europe/Rome", at("2026-03-29T22:00:00Z"))).toBe(
      "2026-03-30",
    );
  });
});

describe("clockIn", () => {
  it("is the HH:MM on the Owner timezone's clock", () => {
    expect(clockIn("Europe/Rome", at("2026-10-17T12:30:00Z"))).toBe("14:30");
    expect(clockIn("Europe/Rome", at("2026-10-25T23:05:00Z"))).toBe("00:05");
  });
});

describe("dayLabel", () => {
  it("names a day by its weekday, whatever the laptop's zone", () => {
    expect(dayLabel("2026-10-15", "weekday")).toBe("Thu 15");
    expect(dayLabel("2026-10-19", "full")).toBe("Mon 19 Oct");
    expect(dayLabel("2026-11-01", "full")).toBe("Sun 1 Nov");
  });
});
