import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/test-db.js";

const T = "2026-10-17T10:00:00.000Z";
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function setup() {
  const { sqlite } = createTestDb();
  cleanups.push(() => sqlite.close());
  return sqlite;
}

const insertTodo = (
  sqlite: Database.Database,
  over: Record<string, unknown> = {},
) => {
  const row = {
    id: "t1",
    title: "Gym",
    created_by: "you",
    created_by_token: "dashboard",
    created_at: T,
    updated_at: T,
    ...over,
  };
  const cols = Object.keys(row);
  sqlite
    .prepare(
      `INSERT INTO todos (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    )
    .run(...Object.values(row));
};

describe("todos table (0005)", () => {
  it("creates both tables and the named indexes", () => {
    const sqlite = setup();
    const names = (type: string) =>
      (
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = ?")
          .all(type) as Array<{ name: string }>
      ).map((r) => r.name);
    expect(names("table")).toEqual(
      expect.arrayContaining(["todos", "todo_references"]),
    );
    expect(names("index")).toEqual(
      expect.arrayContaining([
        "todos_open_day",
        "todos_parent",
        "todos_due",
        "todos_closed",
      ]),
    );
  });

  it("defaults a new row to open, position 0 and no Reminder attempts", () => {
    const sqlite = setup();
    insertTodo(sqlite);
    expect(
      sqlite
        .prepare(
          "SELECT state, position, reminder_attempts, day, reminder_status FROM todos",
        )
        .get(),
    ).toEqual({
      state: "open",
      position: 0,
      reminder_attempts: 0,
      day: null,
      reminder_status: null,
    });
  });

  it("rejects an unknown state or actor", () => {
    const sqlite = setup();
    expect(() => insertTodo(sqlite, { state: "canceled" })).toThrow(/CHECK/);
    expect(() => insertTodo(sqlite, { created_by: "bot" })).toThrow(/CHECK/);
    for (const [i, state] of ["open", "done", "dropped"].entries()) {
      insertTodo(sqlite, { id: `ok${i}`, state });
    }
  });

  it("allows a Reminder only on a day, and pairs its time with a status", () => {
    const sqlite = setup();
    expect(() =>
      insertTodo(sqlite, {
        reminder_time: "15:00",
        reminder_status: "pending",
      }),
    ).toThrow(/CHECK/);
    expect(() =>
      insertTodo(sqlite, { day: "2026-10-20", reminder_time: "15:00" }),
    ).toThrow(/CHECK/);
    expect(() =>
      insertTodo(sqlite, { day: "2026-10-20", reminder_status: "pending" }),
    ).toThrow(/CHECK/);
    insertTodo(sqlite, {
      day: "2026-10-20",
      reminder_time: "15:00",
      reminder_status: "pending",
    });
  });

  it("enforces the parent and reference foreign keys", () => {
    const sqlite = setup();
    expect(() => insertTodo(sqlite, { parent_id: "missing" })).toThrow(
      /FOREIGN KEY/,
    );
    insertTodo(sqlite);
    insertTodo(sqlite, { id: "t2", parent_id: "t1" });
    expect(() =>
      sqlite
        .prepare(
          "INSERT INTO todo_references (todo_id, project_id) VALUES ('t1', 'missing')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it("stores a project reference once per To-do", () => {
    const sqlite = setup();
    sqlite.prepare("INSERT INTO issue_keys (key) VALUES ('CRM')").run();
    sqlite
      .prepare(
        "INSERT INTO projects (id, key, name, created_by, created_at, updated_at) VALUES ('p1','CRM','CRM','you',?,?)",
      )
      .run(T, T);
    insertTodo(sqlite);
    const ref = sqlite.prepare(
      "INSERT INTO todo_references (todo_id, project_id) VALUES ('t1', 'p1')",
    );
    ref.run();
    expect(() => ref.run()).toThrow(/UNIQUE|PRIMARY KEY/);
  });
});
