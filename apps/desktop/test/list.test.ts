import { describe, expect, it } from "vitest";
import type { Todo } from "../src/api-client";
import { buildSections, headingOf, listCounts } from "../src/list";
import { todo } from "./todos";

const TODAY = "2026-10-17";

/** The sections as `label: ids`, the way the window reads top to bottom. */
const outline = (todos: Todo[]) =>
  buildSections(todos, TODAY).map(
    (s) =>
      `${headingOf(s, TODAY).label}: ${s.items.map((t) => t.id).join(" ")}`,
  );

describe("buildSections", () => {
  it("puts Overdue first, oldest day first, then by Position within a day", () => {
    const todos = [
      todo({ id: "a", day: "2026-10-16", position: 1 }),
      todo({ id: "b", day: "2026-10-15", position: 3 }),
      todo({ id: "c", day: "2026-10-16", position: 0 }),
      todo({ id: "d", day: "2026-10-15", position: 1 }),
    ];
    expect(outline(todos)).toEqual(["Overdue: d b c a", "Today: "]);
  });

  it("always has Today, even with nothing planned", () => {
    const sections = buildSections([], TODAY);
    expect(sections.map((s) => s.kind)).toEqual(["today"]);
    expect(headingOf(sections[0]!, TODAY)).toEqual({
      label: "Today",
      detail: "Sat 17 Oct",
    });
  });

  it("gives each later day with To-dos its own heading and skips empty days", () => {
    const todos = [
      todo({ id: "far", day: "2026-11-02" }),
      todo({ id: "tomorrow", day: "2026-10-18" }),
      todo({ id: "monday", day: "2026-10-19" }),
      todo({ id: "today", day: TODAY }),
    ];
    expect(outline(todos)).toEqual([
      "Today: today",
      "Tomorrow: tomorrow",
      "Mon 19 Oct: monday",
      "Mon 2 Nov: far",
    ]);
  });

  it("orders a day and Anytime by Position, and puts Anytime last", () => {
    const todos = [
      todo({ id: "any2", day: null, position: 2 }),
      todo({ id: "t2", day: TODAY, position: 5 }),
      todo({ id: "any1", day: null, position: 1 }),
      todo({ id: "t1", day: TODAY, position: 4 }),
      todo({ id: "later", day: "2026-10-20" }),
    ];
    expect(outline(todos)).toEqual([
      "Today: t1 t2",
      "Tue 20 Oct: later",
      "Anytime: any1 any2",
    ]);
  });

  it("puts a Sub-to-do on its own Planned day, not under its parent", () => {
    const todos = [
      todo({
        id: "parent",
        day: "2026-10-23",
        subTodos: { done: 1, total: 3 },
      }),
      todo({ id: "sub", day: TODAY, parentId: "parent" }),
    ];
    expect(outline(todos)).toEqual(["Today: sub", "Fri 23 Oct: parent"]);
  });

  it("counts the open To-dos of each section", () => {
    const sections = buildSections(
      [
        todo({ id: "a", day: TODAY }),
        todo({ id: "b", day: TODAY, state: "done" }),
        todo({ id: "c", day: null }),
      ],
      TODAY,
    );
    expect(sections.map((s) => [s.kind, s.open])).toEqual([
      ["today", 1],
      ["anytime", 1],
    ]);
  });

  it("labels the Overdue and Anytime headings", () => {
    const [overdue, , anytime] = buildSections(
      [todo({ day: "2026-10-01" }), todo({ day: null })],
      TODAY,
    );
    expect(headingOf(overdue!, TODAY)).toEqual({ label: "Overdue" });
    expect(headingOf(anytime!, TODAY)).toEqual({ label: "Anytime" });
  });
});

describe("listCounts", () => {
  it("counts today as a Planned day of today or earlier, and every open To-do", () => {
    const todos = [
      todo({ day: "2026-10-12" }),
      todo({ day: TODAY }),
      todo({ day: TODAY, state: "done" }),
      todo({ day: "2026-10-18" }),
      todo({ day: null }),
    ];
    expect(listCounts(todos, TODAY)).toEqual({ today: 2, open: 4 });
  });
});
