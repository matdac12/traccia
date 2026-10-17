import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "../lib/personal/quick-add";

// A Saturday.
const TODAY = "2026-10-17";

describe("parseQuickAdd", () => {
  it("keeps a plain title as typed, with no day or time", () => {
    expect(parseQuickAdd("Review invoices @CRM", TODAY)).toEqual({ title: "Review invoices @CRM", day: null, time: null });
  });

  it.each([
    ["today", "2026-10-17"],
    ["oggi", "2026-10-17"],
    ["tomorrow", "2026-10-18"],
    ["Domani", "2026-10-18"],
    ["TOMORROW", "2026-10-18"],
  ])("reads %s as a Planned day and takes it out of the title", (word, day) => {
    expect(parseQuickAdd(`Call Luca ${word} about it`, TODAY)).toEqual({ title: "Call Luca about it", day, time: null });
  });

  it.each([
    ["sun", "2026-10-18"],
    ["mon", "2026-10-19"],
    ["Wed", "2026-10-21"],
    ["fri", "2026-10-23"],
    // Today is a Saturday, so "sat" is the next one, a week ahead.
    ["sat", "2026-10-24"],
  ])("reads %s as the next such day", (word, day) => {
    expect(parseQuickAdd(`Gym ${word}`, TODAY)).toEqual({ title: "Gym", day, time: null });
  });

  it("finds day words only as whole words, never inside another word or a Project key", () => {
    expect(parseQuickAdd("Sunday brunch with Monica", TODAY)).toEqual({ title: "Sunday brunch with Monica", day: null, time: null });
    expect(parseQuickAdd("Ship @MON release", TODAY)).toEqual({ title: "Ship @MON release", day: null, time: null });
  });

  it("reads HH:MM as the Reminder time, on today when no day is typed", () => {
    expect(parseQuickAdd("Call the bank 15:00", TODAY)).toEqual({ title: "Call the bank", day: TODAY, time: "15:00" });
  });

  it("puts the time on the typed day, in either order", () => {
    const expected = { title: "Review invoices @CRM", day: "2026-10-18", time: "10:00" };
    expect(parseQuickAdd("Review invoices @CRM tomorrow 10:00", TODAY)).toEqual(expected);
    expect(parseQuickAdd("Review invoices 10:00 tomorrow @CRM", TODAY)).toEqual(expected);
  });

  it("pads a one-digit hour", () => {
    expect(parseQuickAdd("Run 7:30 mon", TODAY)).toEqual({ title: "Run", day: "2026-10-19", time: "07:30" });
  });

  it("leaves what is not a time of day in the title", () => {
    for (const title of ["Watch 24:00 again", "Score 10:60", "Ratio 1:2", "Build 3:15pm", "Log at 10:00:00", "Read Acts 2:15b"]) {
      expect(parseQuickAdd(title, TODAY)).toEqual({ title, day: null, time: null });
    }
  });

  it("takes the last day word and the last time when there are several, and leaves the others in the title", () => {
    expect(parseQuickAdd("Ask Sun about the 9:00 call tomorrow 15:00", TODAY)).toEqual({ title: "Ask Sun about the 9:00 call", day: "2026-10-18", time: "15:00" });
  });

  it("leaves day words inside longer words, and time ranges, in the title", () => {
    for (const title of ["Write today's report", "Buy sun-cream", "Pack for tomorrow’s trip", "Meeting 9:00-10:00"]) {
      expect(parseQuickAdd(title, TODAY)).toEqual({ title, day: null, time: null });
    }
  });

  it("returns an empty title when the line is only a day and a time", () => {
    expect(parseQuickAdd("  tomorrow 09:00 ", TODAY)).toEqual({ title: "", day: "2026-10-18", time: "09:00" });
  });
});
