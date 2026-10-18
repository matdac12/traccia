import { describe, expect, it } from "vitest";
import {
  canPageBack,
  inText,
  monthGrid,
  monthName,
  moveDayCursor,
  moveTimeIndex,
  nextMonday,
  parseTimeInput,
  reminderChips,
  startIndex,
  timeCandidates,
  typedPassed,
} from "../src/pickers";

// Sat 17 Oct 2026 in the Owner timezone.
const TODAY = "2026-10-17";

describe("parseTimeInput", () => {
  it.each([
    ["9", "09:00"],
    ["930", "09:30"],
    ["9:30", "09:30"],
    ["09:30", "09:30"],
    ["1430", "14:30"],
    ["14:30", "14:30"],
    ["0", "00:00"],
    ["23:59", "23:59"],
    ["2pm", "14:00"],
    ["2 PM", "14:00"],
    ["2:15p", "14:15"],
    ["9am", "09:00"],
    ["12pm", "12:00"],
    ["12am", "00:00"],
    [" 18 ", "18:00"],
  ])("reads %j as %s", (raw, time) => {
    expect(parseTimeInput(raw)).toBe(time);
  });

  it.each(["", "24", "9:60", "25:00", "13pm", "0am", "abc", "9:3", "12345"])(
    "refuses %j",
    (raw) => {
      expect(parseTimeInput(raw)).toBeNull();
    },
  );
});

describe("inText", () => {
  it("says how far ahead a time is", () => {
    expect(inText("16:45", "14:32")).toBe("in 2 h 13 min");
    expect(inText("15:00", "14:32")).toBe("in 28 min");
    expect(inText("15:32", "14:32")).toBe("in 1 h");
  });
});

describe("timeCandidates", () => {
  const times = (cands: { time: string }[]) => cands.map((c) => c.time);

  it("lists only the quarter hours still ahead today, each with how far", () => {
    const cands = timeCandidates({ query: "", onToday: true, now: "14:32" });
    expect(cands[0]).toEqual({
      time: "14:45",
      past: false,
      hint: "in 13 min",
    });
    expect(cands.at(-1)?.time).toBe("23:45");
    expect(cands).toHaveLength(37);
    expect(cands.find((c) => c.time === "16:45")?.hint).toBe("in 2 h 13 min");
  });

  it("doesn't count the current minute as ahead", () => {
    const cands = timeCandidates({ query: "", onToday: true, now: "14:30" });
    expect(cands[0]?.time).toBe("14:45");
  });

  it("lists the whole day on other days, with no hints", () => {
    const cands = timeCandidates({ query: "", onToday: false, now: "14:32" });
    expect(cands).toHaveLength(96);
    expect(cands[0]).toEqual({ time: "00:00", past: false, hint: "" });
    expect(cands.every((c) => !c.past)).toBe(true);
  });

  it("narrows to a typed time and its quarter hours", () => {
    expect(
      times(timeCandidates({ query: "1520", onToday: false, now: "14:32" })),
    ).toEqual(["15:20", "15:00", "15:15", "15:30", "15:45"]);
    expect(
      times(timeCandidates({ query: "9", onToday: false, now: "14:32" })),
    ).toEqual(["09:00", "09:15", "09:30", "09:45"]);
  });

  it("suggests the evening first for a morning time already passed today: 9 at 14:32 is 21:00", () => {
    const cands = timeCandidates({ query: "9", onToday: true, now: "14:32" });
    expect(times(cands)).toEqual(["21:00", "09:00", "09:15", "09:30", "09:45"]);
    expect(cands[0]).toEqual({
      time: "21:00",
      past: false,
      hint: "in 6 h 28 min",
    });
    expect(
      cands.slice(1).every((c) => c.past && c.hint === "already passed"),
    ).toBe(true);
    expect(
      startIndex(cands, { query: "9", current: null, onToday: true }),
    ).toBe(0);
    expect(typedPassed("9", cands)).toBe(false);
  });

  it("suggests nothing for an afternoon time already passed, and highlights nothing", () => {
    const cands = timeCandidates({
      query: "14:00",
      onToday: true,
      now: "14:32",
    });
    expect(times(cands)).toEqual(["14:00", "14:15", "14:30", "14:45"]);
    expect(cands.map((c) => c.past)).toEqual([true, true, true, false]);
    expect(
      startIndex(cands, { query: "14:00", current: null, onToday: true }),
    ).toBe(-1);
    expect(typedPassed("14:00", cands)).toBe(true);
  });

  it("lists nothing for a time it can't read", () => {
    expect(
      timeCandidates({ query: "soon", onToday: true, now: "14:32" }),
    ).toEqual([]);
  });
});

describe("startIndex and moveTimeIndex", () => {
  it("starts on 09:00 on other days, on the first time today, or on the Reminder already set", () => {
    const other = timeCandidates({ query: "", onToday: false, now: "14:32" });
    expect(
      other[startIndex(other, { query: "", current: null, onToday: false })]
        ?.time,
    ).toBe("09:00");
    expect(
      other[startIndex(other, { query: "", current: "18:00", onToday: false })]
        ?.time,
    ).toBe("18:00");
    const today = timeCandidates({ query: "", onToday: true, now: "14:32" });
    expect(startIndex(today, { query: "", current: null, onToday: true })).toBe(
      0,
    );
  });

  it("skips past times with ↑ ↓, and stays at either end", () => {
    const cands = timeCandidates({ query: "15", onToday: true, now: "15:20" });
    // 15:00 and 15:15 have passed: 15:00, 15:15, 15:30, 15:45.
    expect(cands.map((c) => c.past)).toEqual([true, true, false, false]);
    expect(moveTimeIndex(cands, 3, -1)).toBe(2);
    expect(moveTimeIndex(cands, 2, -1)).toBe(2);
    expect(moveTimeIndex(cands, 2, 1)).toBe(3);
    expect(moveTimeIndex(cands, 3, 1)).toBe(3);
    // From nothing highlighted, ↓ goes to the first pickable time.
    expect(moveTimeIndex(cands, -1, 1)).toBe(2);
  });
});

describe("reminderChips", () => {
  it("offers in 30 min, 1 h and 2 h and Tonight today", () => {
    expect(reminderChips(true, "14:32")).toEqual([
      { label: "in 30 min", time: "15:02" },
      { label: "in 1 h", time: "15:32" },
      { label: "in 2 h", time: "16:32" },
      { label: "Tonight", time: "21:00" },
    ]);
  });

  it("drops Tonight once 21:00 has come, and the ones past midnight", () => {
    expect(reminderChips(true, "21:00").map((c) => c.label)).toEqual([
      "in 30 min",
      "in 1 h",
      "in 2 h",
    ]);
    expect(reminderChips(true, "22:45").map((c) => c.time)).toEqual([
      "23:15",
      "23:45",
    ]);
  });

  it("offers Morning, Lunch, Afternoon and Evening on other days", () => {
    expect(reminderChips(false, "14:32")).toEqual([
      { label: "Morning", time: "09:00" },
      { label: "Lunch", time: "12:30" },
      { label: "Afternoon", time: "15:00" },
      { label: "Evening", time: "18:00" },
    ]);
  });
});

describe("the month grid", () => {
  it("starts on Monday", () => {
    // 1 Oct 2026 is a Thursday; 1 Feb 2027 a Monday; 1 Nov 2026 a Sunday.
    expect(monthGrid("2026-10-01").lead).toBe(3);
    expect(monthGrid("2027-02-01")).toMatchObject({ lead: 0 });
    expect(monthGrid("2026-11-01").lead).toBe(6);
    expect(monthGrid("2026-10-01").days).toHaveLength(31);
    expect(monthGrid("2027-02-01").days.at(-1)).toBe("2027-02-28");
    expect(monthGrid("2028-02-01").days.at(-1)).toBe("2028-02-29");
    expect(monthName("2026-10-01")).toBe("October 2026");
  });

  it("can't page before the current month", () => {
    expect(canPageBack("2026-10-01", TODAY)).toBe(false);
    expect(canPageBack("2026-11-01", TODAY)).toBe(true);
  });

  it("names next Monday, a week ahead on a Monday", () => {
    expect(nextMonday(TODAY)).toBe("2026-10-19");
    expect(nextMonday("2026-10-19")).toBe("2026-10-26");
    expect(nextMonday("2026-10-18")).toBe("2026-10-19");
  });
});

describe("moveDayCursor", () => {
  it("moves a day with ← → and a week with ↑ ↓, across month and year ends", () => {
    expect(moveDayCursor("2026-10-31", "ArrowRight", TODAY)).toBe("2026-11-01");
    expect(moveDayCursor("2026-11-01", "ArrowLeft", TODAY)).toBe("2026-10-31");
    expect(moveDayCursor("2026-10-28", "ArrowDown", TODAY)).toBe("2026-11-04");
    expect(moveDayCursor("2026-11-04", "ArrowUp", TODAY)).toBe("2026-10-28");
    expect(moveDayCursor("2026-12-29", "ArrowDown", TODAY)).toBe("2027-01-05");
  });

  it("never goes before today", () => {
    expect(moveDayCursor(TODAY, "ArrowLeft", TODAY)).toBe(TODAY);
    expect(moveDayCursor("2026-10-20", "ArrowUp", TODAY)).toBe(TODAY);
  });

  it("changes month with PgUp and PgDn, keeping the date or the month's last", () => {
    expect(moveDayCursor("2026-10-23", "PageDown", TODAY)).toBe("2026-11-23");
    expect(moveDayCursor("2027-01-31", "PageDown", TODAY)).toBe("2027-02-28");
    expect(moveDayCursor("2026-12-31", "PageDown", TODAY)).toBe("2027-01-31");
    expect(moveDayCursor("2027-01-15", "PageUp", TODAY)).toBe("2026-12-15");
    // Back into the current month, never before today; not before the current month at all.
    expect(moveDayCursor("2026-11-05", "PageUp", TODAY)).toBe(TODAY);
    expect(moveDayCursor("2026-10-23", "PageUp", TODAY)).toBe("2026-10-23");
  });

  it("goes back to today on Home, and ignores other keys", () => {
    expect(moveDayCursor("2027-03-09", "Home", TODAY)).toBe(TODAY);
    expect(moveDayCursor("2027-03-09", "Enter", TODAY)).toBeNull();
    expect(moveDayCursor("2027-03-09", "a", TODAY)).toBeNull();
  });
});
