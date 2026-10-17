import { describe, expect, it, vi } from "vitest";
import { createServices } from "../../src/service/index.js";
import { createTestDb } from "../helpers/test-db.js";
import { code, onCleanup } from "./helpers.js";

// §4: every To-do write tells the Reminder scheduler, through the
// `onTodosChanged` callback, once the write has committed.

function setup() {
  const { sqlite, db } = createTestDb();
  onCleanup(() => sqlite.close());
  const onTodosChanged = vi.fn();
  const services = createServices({
    db,
    defaultIssueKey: "MAT",
    onTodosChanged,
  });
  return { services, onTodosChanged };
}

describe("onTodosChanged", () => {
  it("runs once after each To-do write", async () => {
    const { services, onTodosChanged } = setup();
    const calls = () => onTodosChanged.mock.calls.length;

    const a = services.todos.create("you", "t", { title: "A", day: null });
    expect(calls()).toBe(1);
    const b = services.todos.create("you", "t", { title: "B", day: null });
    expect(calls()).toBe(2);
    services.todos.update(a.id, { title: "A2" });
    expect(calls()).toBe(3);
    services.todos.move(a.id, { afterId: b.id });
    expect(calls()).toBe(4);
    await services.trash.delete("you", "todo", a.id);
    expect(calls()).toBe(5);
    services.trash.restore("you", "todo", a.id);
    expect(calls()).toBe(6);
    services.trash.softDelete("you", "todo", b.id);
    expect(calls()).toBe(7);
    await services.trash.delete("you", "todo", b.id, { purge: true });
    expect(calls()).toBe(8);
  });

  it("doesn't run when the write fails", () => {
    const { services, onTodosChanged } = setup();
    expect(code(() => services.todos.update("nope", { title: "x" }))).toBe(
      "not_found",
    );
    expect(code(() => services.trash.restore("you", "todo", "nope"))).toBe(
      "not_found",
    );
    expect(onTodosChanged).not.toHaveBeenCalled();
  });

  it("doesn't run for other Trash types", async () => {
    const { services, onTodosChanged } = setup();
    const project = services.projects.create("you", { name: "P", key: "PP" });
    await services.trash.delete("you", "project", project.id);
    services.trash.restore("you", "project", project.id);
    expect(onTodosChanged).not.toHaveBeenCalled();
  });
});
