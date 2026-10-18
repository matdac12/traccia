import { QUICK_ADD_REMINDER_NEEDS_DAY } from "@traccia/shared";
import { describe, expect, it } from "vitest";
import {
  addedText,
  canAdd,
  composerDraft,
  createBody,
  dayName,
  TIME_PASSED,
  typedCharacter,
} from "../src/composer";

// Sat 17 Oct 2026, 14:30 in the Owner timezone.
const at = { today: "2026-10-17", now: "14:30" };

describe("composerDraft", () => {
  it("defaults to Today and no Reminder, nothing typed", () => {
    expect(composerDraft("Call Marco @CRM", at)).toEqual({
      title: "Call Marco @CRM",
      day: "2026-10-17",
      time: null,
      dayTyped: false,
      timeTyped: false,
      error: null,
    });
  });

  it("takes a typed day and time out of the title, and tags them typed", () => {
    expect(composerDraft("Call Marco @CRM tomorrow 15:00", at)).toEqual({
      title: "Call Marco @CRM",
      day: "2026-10-18",
      time: "15:00",
      dayTyped: true,
      timeTyped: true,
      error: null,
    });
  });

  it("puts a time with no day word on today, the day not typed", () => {
    const draft = composerDraft("Gym 19:00", at);
    expect(draft).toMatchObject({ day: "2026-10-17", time: "19:00" });
    expect(draft.dayTyped).toBe(false);
  });

  it("reads anytime as no Planned day", () => {
    expect(composerDraft("Read a book anytime", at)).toMatchObject({
      title: "Read a book",
      day: null,
      dayTyped: true,
      error: null,
    });
  });

  it("refuses a time that has already passed today, the current minute included", () => {
    expect(composerDraft("Gym 09:00", at).error).toBe(TIME_PASSED);
    expect(composerDraft("Gym 14:30", at).error).toBe(TIME_PASSED);
    expect(composerDraft("Gym 14:31", at).error).toBeNull();
    expect(composerDraft("Gym tomorrow 09:00", at).error).toBeNull();
  });

  it("refuses anytime with a time", () => {
    expect(composerDraft("Call anytime 15:00", at).error).toBe(
      QUICK_ADD_REMINDER_NEEDS_DAY,
    );
  });

  it("uses a picked day and time when the title names none, and the typed ones over them", () => {
    const picked = { day: "2026-10-20", time: "18:00" };
    expect(composerDraft("Dentist", { ...at, picked })).toMatchObject({
      day: "2026-10-20",
      time: "18:00",
      dayTyped: false,
      timeTyped: false,
    });
    expect(
      composerDraft("Dentist tomorrow 09:00", { ...at, picked }),
    ).toMatchObject({ day: "2026-10-18", time: "09:00" });
    expect(
      composerDraft("Dentist 15:00", { ...at, picked: { day: null } }).error,
    ).toBe(QUICK_ADD_REMINDER_NEEDS_DAY);
  });
});

describe("canAdd", () => {
  it("needs a title and no error", () => {
    expect(canAdd(composerDraft("Gym", at))).toBe(true);
    expect(canAdd(composerDraft("tomorrow 15:00", at))).toBe(false);
    expect(canAdd(composerDraft("  ", at))).toBe(false);
    expect(canAdd(composerDraft("Gym 09:00", at))).toBe(false);
  });
});

describe("createBody", () => {
  it("posts the title, day and time", () => {
    expect(
      createBody(composerDraft("Call Marco @CRM tomorrow 15:00", at)),
    ).toEqual({ title: "Call Marco @CRM", day: "2026-10-18", time: "15:00" });
  });

  it("sends today by default, and no time without a Reminder", () => {
    expect(createBody(composerDraft("Gym", at))).toEqual({
      title: "Gym",
      day: "2026-10-17",
    });
  });

  it("omits day for Anytime", () => {
    expect(createBody(composerDraft("Read a book anytime", at))).toEqual({
      title: "Read a book",
    });
  });
});

describe("dayName and addedText", () => {
  it("names the day as the list does", () => {
    expect(dayName("2026-10-17", at.today)).toBe("Today");
    expect(dayName("2026-10-18", at.today)).toBe("Tomorrow");
    expect(dayName("2026-10-20", at.today)).toBe("Tue 20 Oct");
    expect(dayName(null, at.today)).toBe("Anytime");
  });

  it("says where the To-do went, and its Reminder", () => {
    expect(addedText({ day: "2026-10-20", time: "18:00" }, at.today)).toBe(
      "Added to Tue 20 Oct · Reminder 18:00",
    );
    expect(addedText({ day: null, time: null }, at.today)).toBe(
      "Added to Anytime",
    );
  });
});

describe("typedCharacter", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("is the character of a plain or shifted key", () => {
    expect(typedCharacter(key({ key: "c" }))).toBe("c");
    expect(typedCharacter(key({ key: "C", shiftKey: true }))).toBe("C");
    expect(typedCharacter(key({ key: " " }))).toBe(" ");
  });

  it("is null for shortcuts and named keys", () => {
    expect(typedCharacter(key({ key: "z", ctrlKey: true }))).toBeNull();
    expect(typedCharacter(key({ key: "f", altKey: true }))).toBeNull();
    expect(typedCharacter(key({ key: "Enter" }))).toBeNull();
    expect(typedCharacter(key({ key: "ArrowDown" }))).toBeNull();
  });

  it("lets AltGr through, which types @ on an Italian keyboard", () => {
    const altGr = key({ key: "@", ctrlKey: true, altKey: true });
    Object.defineProperty(altGr, "getModifierState", {
      value: (name: string) => name === "AltGraph",
    });
    expect(typedCharacter(altGr)).toBe("@");
  });
});
