import { describe, expect, it } from "vitest";
import { instantIn, todayIn, wallClockIn } from "../src/time.js";

const ROME = "Europe/Rome";

describe("todayIn", () => {
  it("is the calendar day in the zone, not in UTC", () => {
    // 23:30 UTC on the 19th is already the 20th in Rome (UTC+2 in October).
    expect(todayIn(ROME, new Date("2026-10-19T23:30:00Z"))).toBe("2026-10-20");
    expect(todayIn(ROME, new Date("2026-10-19T21:59:00Z"))).toBe("2026-10-19");
    expect(todayIn("UTC", new Date("2026-10-19T23:30:00Z"))).toBe("2026-10-19");
  });
});

describe("instantIn", () => {
  it("turns a day and HH:MM in the zone into a UTC instant", () => {
    expect(instantIn(ROME, "2026-10-20", "15:00").toISOString()).toBe(
      "2026-10-20T13:00:00.000Z",
    );
    expect(instantIn(ROME, "2026-01-15", "09:30").toISOString()).toBe(
      "2026-01-15T08:30:00.000Z",
    );
  });

  it("handles both sides of the October and March changes", () => {
    // Rome leaves summer time at 03:00 on 2026-10-25 and enters it at 02:00 on 2026-03-29.
    expect(instantIn(ROME, "2026-10-24", "12:00").toISOString()).toBe(
      "2026-10-24T10:00:00.000Z",
    );
    expect(instantIn(ROME, "2026-10-25", "12:00").toISOString()).toBe(
      "2026-10-25T11:00:00.000Z",
    );
    expect(instantIn(ROME, "2026-03-28", "12:00").toISOString()).toBe(
      "2026-03-28T11:00:00.000Z",
    );
    expect(instantIn(ROME, "2026-03-29", "12:00").toISOString()).toBe(
      "2026-03-29T10:00:00.000Z",
    );
  });

  it("takes the first of a repeated time and moves a skipped one forward", () => {
    // 02:30 happens twice on 2026-10-25: the first is still summer time.
    expect(instantIn(ROME, "2026-10-25", "02:30").toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
    // 02:30 does not exist on 2026-03-29; it reads as 03:30 summer time.
    expect(instantIn(ROME, "2026-03-29", "02:30").toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
  });
});

describe("wallClockIn", () => {
  it("gives the day and HH:MM of an instant in the zone, dropping seconds", () => {
    expect(wallClockIn(ROME, new Date("2026-10-20T13:00:59.900Z"))).toEqual({
      day: "2026-10-20",
      time: "15:00",
    });
    expect(wallClockIn(ROME, new Date("2026-10-19T22:05:00Z"))).toEqual({
      day: "2026-10-20",
      time: "00:05",
    });
  });

  it("round-trips with instantIn across the DST changes", () => {
    for (const iso of [
      "2026-10-25T00:30:00.000Z",
      "2026-10-25T01:30:00.000Z",
      "2026-03-29T00:59:00.000Z",
      "2026-03-29T01:00:00.000Z",
    ]) {
      const { day, time } = wallClockIn(ROME, new Date(iso));
      const back = instantIn(ROME, day, time);
      // The repeated hour on 25 October maps back to its first occurrence.
      expect(wallClockIn(ROME, back)).toEqual({ day, time });
    }
  });
});
