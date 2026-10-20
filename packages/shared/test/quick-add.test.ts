import { describe, expect, it } from "vitest";
import { parseQuickAdd, QUICK_ADD_REMINDER_NEEDS_DAY, withoutQuickAddWords } from "../src/quick-add.js";

// A Saturday.
const TODAY = "2026-10-17";

/** What the Dashboard reads from a line: title, Planned day and Reminder time (the typed flags are tested below). */
function read(input: string, today: string) {
  const { title, day, time } = parseQuickAdd(input, today);
  return { title, day, time };
}

describe("parseQuickAdd: title, day and time", () => {
  it("keeps a plain title as typed, with no day or time", () => {
    expect(read("Review invoices @CRM", TODAY)).toEqual({ title: "Review invoices @CRM", day: null, time: null });
  });

  it.each([
    ["today", "2026-10-17"],
    ["oggi", "2026-10-17"],
    ["tomorrow", "2026-10-18"],
    ["Domani", "2026-10-18"],
    ["TOMORROW", "2026-10-18"],
  ])("reads %s as a Planned day and takes it out of the title", (word, day) => {
    expect(read(`Call Luca ${word} about it`, TODAY)).toEqual({ title: "Call Luca about it", day, time: null });
  });

  it.each([
    ["sun", "2026-10-18"],
    ["mon", "2026-10-19"],
    ["Wed", "2026-10-21"],
    ["fri", "2026-10-23"],
    // Today is a Saturday, so "sat" is the next one, a week ahead.
    ["sat", "2026-10-24"],
  ])("reads %s as the next such day", (word, day) => {
    expect(read(`Gym ${word}`, TODAY)).toEqual({ title: "Gym", day, time: null });
  });

  it("finds day words only as whole words, never inside another word or a Project key", () => {
    expect(read("Brunch with Monica", TODAY)).toEqual({ title: "Brunch with Monica", day: null, time: null });
    expect(read("Ship @MON release", TODAY)).toEqual({ title: "Ship @MON release", day: null, time: null });
  });

  // Today is a Saturday (2026-10-17), so the week runs: sun 18, mon 19, tue 20, wed 21, thu 22, fri 23, sat 24.
  it.each([
    ["sunday", "2026-10-18"], ["dom", "2026-10-18"], ["domenica", "2026-10-18"],
    ["monday", "2026-10-19"], ["lun", "2026-10-19"], ["lunedì", "2026-10-19"], ["lunedi", "2026-10-19"],
    ["tue", "2026-10-20"], ["tuesday", "2026-10-20"], ["mar", "2026-10-20"], ["martedì", "2026-10-20"], ["martedi", "2026-10-20"],
    ["wednesday", "2026-10-21"], ["mer", "2026-10-21"], ["mercoledì", "2026-10-21"], ["mercoledi", "2026-10-21"],
    ["thu", "2026-10-22"], ["thursday", "2026-10-22"], ["gio", "2026-10-22"], ["giovedì", "2026-10-22"], ["giovedi", "2026-10-22"],
    ["friday", "2026-10-23"], ["ven", "2026-10-23"], ["venerdì", "2026-10-23"], ["venerdi", "2026-10-23"],
    ["saturday", "2026-10-24"], ["sab", "2026-10-24"], ["sabato", "2026-10-24"],
  ])("reads the weekday word %s as the next such day", (word, day) => {
    expect(read(`Gym ${word}`, TODAY)).toEqual({ title: "Gym", day, time: null });
  });

  it.each([
    ["Monday", "2026-10-19"],
    ["MONDAY", "2026-10-19"],
    ["Lunedì", "2026-10-19"],
    ["LUNEDÌ", "2026-10-19"],
    ["LUNEDI", "2026-10-19"],
    ["DOM", "2026-10-18"],
  ])("reads the weekday word %s in any case", (word, day) => {
    expect(read(`Gym ${word}`, TODAY)).toEqual({ title: "Gym", day, time: null });
  });

  it("matches weekday words as whole words only", () => {
    for (const title of ["Mondays are slow", "Gym lunedìsera", "Call lunedìs", "Visit domenicano", "Ship @LUN", "non-monday", "monday's plan", "Fix sabotage", "Pay 12.50"]) {
      expect(parseQuickAdd(title, TODAY)).toEqual({ title, day: null, time: null, dayTyped: false, timeTyped: false, error: null });
    }
  });

  it("takes the last weekday word when several are typed, in either language", () => {
    expect(read("Move monday meeting to friday", TODAY)).toEqual({ title: "Move monday meeting to", day: "2026-10-23", time: null });
    expect(read("Sposta lunedì a venerdì", TODAY)).toEqual({ title: "Sposta lunedì a", day: "2026-10-23", time: null });
    expect(read("Gym friday tomorrow lunedì", TODAY)).toEqual({ title: "Gym friday tomorrow", day: "2026-10-19", time: null });
  });

  it("reads HH:MM as the Reminder time, on today when no day is typed", () => {
    expect(read("Call the bank 15:00", TODAY)).toEqual({ title: "Call the bank", day: TODAY, time: "15:00" });
  });

  it("puts the time on the typed day, in either order", () => {
    const expected = { title: "Review invoices @CRM", day: "2026-10-18", time: "10:00" };
    expect(read("Review invoices @CRM tomorrow 10:00", TODAY)).toEqual(expected);
    expect(read("Review invoices 10:00 tomorrow @CRM", TODAY)).toEqual(expected);
  });

  it("pads a one-digit hour", () => {
    expect(read("Run 7:30 mon", TODAY)).toEqual({ title: "Run", day: "2026-10-19", time: "07:30" });
  });

  it("leaves what is not a time of day in the title", () => {
    for (const title of ["Watch 24:00 again", "Score 10:60", "Ratio 1:2", "Build 3:15pm", "Log at 10:00:00", "Read Acts 2:15b"]) {
      expect(read(title, TODAY)).toEqual({ title, day: null, time: null });
    }
  });

  it("takes the last day word and the last time when there are several, and leaves the others in the title", () => {
    expect(read("Ask Sun about the 9:00 call tomorrow 15:00", TODAY)).toEqual({ title: "Ask Sun about the 9:00 call", day: "2026-10-18", time: "15:00" });
  });

  it("leaves day words inside longer words, and time ranges, in the title", () => {
    for (const title of ["Write today's report", "Buy sun-cream", "Pack for tomorrow’s trip", "Meeting 9:00-10:00"]) {
      expect(read(title, TODAY)).toEqual({ title, day: null, time: null });
    }
  });

  it("returns an empty title when the line is only a day and a time", () => {
    expect(read("  tomorrow 09:00 ", TODAY)).toEqual({ title: "", day: "2026-10-18", time: "09:00" });
  });
});

describe("parseQuickAdd: anytime", () => {
  it("reads anytime as no Planned day, typed, and takes it out of the title", () => {
    expect(parseQuickAdd("Read the RFC anytime", TODAY)).toEqual({ title: "Read the RFC", day: null, time: null, dayTyped: true, timeTyped: false, error: null });
    expect(parseQuickAdd("ANYTIME call Luca @CRM", TODAY)).toEqual({ title: "call Luca @CRM", day: null, time: null, dayTyped: true, timeTyped: false, error: null });
  });

  it("is a day word like the others: the last one counts, the other stays in the title, and only as a whole word", () => {
    expect(read("Gym tomorrow anytime", TODAY)).toEqual({ title: "Gym tomorrow", day: null, time: null });
    expect(read("Gym anytime tomorrow", TODAY)).toEqual({ title: "Gym anytime", day: "2026-10-18", time: null });
    for (const title of ["Call me anytime's fine", "Ship @ANYTIME", "anytimes", "non-anytime"]) {
      expect(parseQuickAdd(title, TODAY)).toEqual({ title, day: null, time: null, dayTyped: false, timeTyped: false, error: null });
    }
  });

  it("refuses anytime with a time: a Reminder needs a Planned day", () => {
    expect(parseQuickAdd("Call the bank anytime 15:00", TODAY)).toEqual({
      title: "Call the bank",
      day: null,
      time: "15:00",
      dayTyped: true,
      timeTyped: true,
      error: QUICK_ADD_REMINDER_NEEDS_DAY,
    });
    expect(parseQuickAdd("anytime 15:00", TODAY)).toEqual({ title: "", day: null, time: "15:00", dayTyped: true, timeTyped: true, error: QUICK_ADD_REMINDER_NEEDS_DAY });
    expect(QUICK_ADD_REMINDER_NEEDS_DAY).toMatch(/Reminder needs a Planned day/);
  });
});

describe("parseQuickAdd: typed flags", () => {
  it("flags nothing for a plain title", () => {
    expect(parseQuickAdd("Review invoices @CRM", TODAY)).toEqual({ title: "Review invoices @CRM", day: null, time: null, dayTyped: false, timeTyped: false, error: null });
  });

  it("flags a typed day word", () => {
    expect(parseQuickAdd("Gym mon", TODAY)).toEqual({ title: "Gym", day: "2026-10-19", time: null, dayTyped: true, timeTyped: false, error: null });
    expect(parseQuickAdd("Gym today", TODAY)).toEqual({ title: "Gym", day: TODAY, time: null, dayTyped: true, timeTyped: false, error: null });
  });

  it("flags a typed time, and not the day it implies", () => {
    expect(parseQuickAdd("Call the bank 15:00", TODAY)).toEqual({ title: "Call the bank", day: TODAY, time: "15:00", dayTyped: false, timeTyped: true, error: null });
  });

  it("flags both when both are typed", () => {
    expect(parseQuickAdd("Review invoices @CRM tomorrow 10:00", TODAY)).toEqual({
      title: "Review invoices @CRM",
      day: "2026-10-18",
      time: "10:00",
      dayTyped: true,
      timeTyped: true,
      error: null,
    });
  });

  it("does not flag what stays in the title", () => {
    expect(parseQuickAdd("Write today's report at 3:15pm", TODAY)).toEqual({
      title: "Write today's report at 3:15pm",
      day: null,
      time: null,
      dayTyped: false,
      timeTyped: false,
      error: null,
    });
  });
});

describe("withoutQuickAddWords", () => {
  it("takes the day words out, so the line names no day", () => {
    expect(withoutQuickAddWords("Pay rent fri", "day")).toBe("Pay rent");
    expect(withoutQuickAddWords("mon Call Luca @CRM tomorrow 15:00", "day")).toBe("Call Luca @CRM 15:00");
    expect(withoutQuickAddWords("Read a book Anytime", "day")).toBe("Read a book");
    expect(parseQuickAdd(withoutQuickAddWords("Call mon about tue fri", "day"), TODAY).dayTyped).toBe(false);
  });

  it("takes the times out, so the line names no time", () => {
    expect(withoutQuickAddWords("Gym 9:00 tomorrow 18:30", "time")).toBe("Gym tomorrow");
    expect(parseQuickAdd(withoutQuickAddWords("Gym 18:30", "time"), TODAY).timeTyped).toBe(false);
  });

  it("leaves words that only look like them: Monica, @MON, sundays, 10:00:00, 3:15pm", () => {
    expect(withoutQuickAddWords("Monica @MON sundays", "day")).toBe("Monica @MON sundays");
    expect(withoutQuickAddWords("Log 10:00:00 at 3:15pm", "time")).toBe("Log 10:00:00 at 3:15pm");
  });
});
