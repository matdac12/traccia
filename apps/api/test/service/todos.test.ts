import { describe, expect, it } from "vitest";
import { deriveReferences } from "../../src/service/todo-references.js";
import { code, setupServices } from "./helpers.js";

describe("todos.create", () => {
  it("creates an open To-do with its Planned day and source", () => {
    const { services } = setupServices();
    const todo = services.todos.create("you", "parla", {
      title: "Gym",
      day: "2026-10-20",
      details: "Legs day",
    });
    expect(todo).toMatchObject({
      title: "Gym",
      day: "2026-10-20",
      details: "Legs day",
      state: "open",
      closedAt: null,
      parentId: null,
      references: [],
      reminder: null,
      source: "parla",
    });
    expect(todo.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(todo.createdAt).toBe(todo.updatedAt);
    expect(todo).not.toHaveProperty("deleted");
  });

  it("keeps the title as typed, trimmed, and makes an undated To-do Anytime", () => {
    const { services } = setupServices();
    const todo = services.todos.create("agent", "a", {
      title: "  Call the bank @CRM ",
    });
    expect(todo).toMatchObject({
      title: "Call the bank @CRM",
      day: null,
      details: null,
    });
  });

  it("puts a new To-do at the bottom of its own bucket", () => {
    const { services } = setupServices();
    const create = (title: string, day?: string) =>
      services.todos.create("you", "t", { title, day });
    const a = create("a", "2026-10-20");
    const b = create("b", "2026-10-20");
    const anytime = create("c");
    const otherDay = create("d", "2026-10-21");
    expect(b.position).toBeGreaterThan(a.position);
    // Another bucket starts afresh rather than below every other row.
    expect(anytime.position).toBe(a.position);
    expect(otherDay.position).toBe(a.position);
  });

  it("refuses an empty or too long title and a malformed day", () => {
    const { services } = setupServices();
    const create = (input: { title: string; day?: string }) => () =>
      services.todos.create("you", "t", input);
    expect(code(create({ title: "  " }))).toBe("validation_error");
    expect(code(create({ title: "x".repeat(501) }))).toBe("validation_error");
    expect(code(create({ title: "x".repeat(500) }))).toBeUndefined();
    expect(code(create({ title: "a", day: "20-10-2026" }))).toBe(
      "validation_error",
    );
    expect(code(create({ title: "a", day: "2026-02-30" }))).toBe(
      "validation_error",
    );
  });
});

describe("todos.get", () => {
  it("returns one To-do and is not_found for an unknown id", () => {
    const { services } = setupServices();
    const todo = services.todos.create("you", "t", { title: "a" });
    expect(services.todos.get(todo.id)).toEqual(todo);
    expect(code(() => services.todos.get("nope"))).toBe("not_found");
  });

  it("returns a deleted To-do, flagged", () => {
    const { services, sqlite } = setupServices();
    const todo = services.todos.create("you", "t", { title: "a" });
    sqlite
      .prepare("UPDATE todos SET deleted_at = ? WHERE id = ?")
      .run("2026-10-17T12:00:00.000Z", todo.id);
    expect(services.todos.get(todo.id)).toMatchObject({
      id: todo.id,
      deleted: true,
    });
  });
});

describe("todos.list", () => {
  function close(
    sqlite: ReturnType<typeof setupServices>["sqlite"],
    id: string,
    state: "done" | "dropped",
    closedAt: string,
  ) {
    sqlite
      .prepare("UPDATE todos SET state = ?, closed_at = ? WHERE id = ?")
      .run(state, closedAt, id);
  }

  it("lists open To-dos by day, Anytime last, then Position", () => {
    const { services } = setupServices();
    const create = (title: string, day?: string) =>
      services.todos.create("you", "t", { title, day });
    create("anytime 1");
    create("tue 1", "2026-10-20");
    create("mon 1", "2026-10-19");
    create("tue 2", "2026-10-20");
    create("anytime 2");
    const page = services.todos.list({ state: "open" });
    expect(page.items.map((t) => t.title)).toEqual([
      "mon 1",
      "tue 1",
      "tue 2",
      "anytime 1",
      "anytime 2",
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("leaves out closed and deleted To-dos unless asked", () => {
    const { services, sqlite } = setupServices();
    const open = services.todos.create("you", "t", { title: "open" });
    const done = services.todos.create("you", "t", { title: "done" });
    const gone = services.todos.create("you", "t", { title: "gone" });
    close(sqlite, done.id, "done", "2026-10-17T09:00:00.000Z");
    sqlite
      .prepare("UPDATE todos SET deleted_at = ? WHERE id = ?")
      .run("2026-10-17T12:00:00.000Z", gone.id);
    expect(
      services.todos.list({ state: "open" }).items.map((t) => t.id),
    ).toEqual([open.id]);
    const all = services.todos.list({ state: "open", includeDeleted: true });
    expect(all.items.map((t) => [t.title, t.deleted])).toEqual([
      ["open", undefined],
      ["gone", true],
    ]);
  });

  it("pages the open list", () => {
    const { services } = setupServices();
    for (const t of ["a", "b", "c"]) {
      services.todos.create("you", "t", { title: t });
    }
    const first = services.todos.list({ state: "open", limit: 2 });
    expect(first.items.map((t) => t.title)).toEqual(["a", "b"]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = services.todos.list({
      state: "open",
      limit: 2,
      cursor: first.nextCursor as string,
    });
    expect(second.items.map((t) => t.title)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
  });

  it("lists the Logbook newest closed first, done and dropped, with keyset paging", () => {
    const { services, sqlite } = setupServices();
    const make = (title: string) =>
      services.todos.create("you", "t", { title });
    services.todos.create("you", "t", { title: "still open" });
    const a = make("a");
    const b = make("b");
    const c = make("c");
    close(sqlite, a.id, "done", "2026-10-15T09:00:00.000Z");
    close(sqlite, b.id, "dropped", "2026-10-17T09:00:00.000Z");
    close(sqlite, c.id, "done", "2026-10-16T09:00:00.000Z");

    const first = services.todos.list({ state: "closed", limit: 2 });
    expect(first.items.map((t) => [t.title, t.state])).toEqual([
      ["b", "dropped"],
      ["c", "done"],
    ]);
    const second = services.todos.list({
      state: "closed",
      limit: 2,
      cursor: first.nextCursor as string,
    });
    expect(second.items.map((t) => t.title)).toEqual(["a"]);
    expect(second.nextCursor).toBeNull();
  });

  it("breaks Logbook ties on the same close time by id", () => {
    const { services, sqlite } = setupServices();
    const ids = ["a", "b", "c"].map(
      (title) => services.todos.create("you", "t", { title }).id,
    );
    for (const id of ids) close(sqlite, id, "done", "2026-10-17T09:00:00.000Z");
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = services.todos.list({ state: "closed", limit: 1, cursor });
      seen.push(...page.items.map((t) => t.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual([...ids].reverse());
  });

  it("refuses an unknown state and a bad or foreign cursor", () => {
    const { services } = setupServices();
    for (const t of ["a", "b"]) services.todos.create("you", "t", { title: t });
    const openCursor = services.todos.list({ state: "open", limit: 1 })
      .nextCursor as string;
    expect(
      code(() => services.todos.list({ state: "later" as unknown as "open" })),
    ).toBe("validation_error");
    expect(
      code(() => services.todos.list({ state: "open", cursor: "!!!" })),
    ).toBe("validation_error");
    expect(
      code(() => services.todos.list({ state: "closed", cursor: openCursor })),
    ).toBe("validation_error");
  });
});

describe("Project references", () => {
  function setup() {
    const t = setupServices();
    const project = (name: string, key: string) =>
      t.services.projects.create("you", { name, key });
    const create = (title: string) =>
      t.services.todos.create("you", "t", { title });
    return { ...t, project, create };
  }

  it("derives a reference from @KEY, case-insensitively, and keeps the title as typed", () => {
    const { project, create } = setup();
    const crm = project("CRM", "CRM");
    const todo = create("Work on @crm UI");
    expect(todo.title).toBe("Work on @crm UI");
    expect(todo.references).toEqual([
      { key: "CRM", projectId: crm.id, projectDeleted: false },
    ]);
  });

  it("gives no reference and no error for an unknown key", () => {
    const { project, create } = setup();
    project("CRM", "CRM");
    expect(create("Check @CMR export").references).toEqual([]);
  });

  it("ignores text that is not a whole key: a lone @, a too short or too long run", () => {
    const { project, create } = setup();
    project("CRM", "CRM");
    project("Eight", "ABCDEFGH");
    for (const title of [
      "email me @ noon",
      "@C is short",
      "@ABCDEFGHI is nine",
      "@1ABC starts with a digit",
    ]) {
      expect(create(title).references).toEqual([]);
    }
    expect(create("@CRM-x1").references.map((r) => r.key)).toEqual(["CRM"]);
    expect(create("@abcdefgh").references.map((r) => r.key)).toEqual([
      "ABCDEFGH",
    ]);
  });

  it("handles two different keys in title order, and a repeated key once", () => {
    const { project, create } = setup();
    const crm = project("CRM", "CRM");
    const web = project("Web", "WEB");
    const todo = create("@web then @CRM then @Web again and @crm");
    expect(todo.references).toEqual([
      { key: "WEB", projectId: web.id, projectDeleted: false },
      { key: "CRM", projectId: crm.id, projectDeleted: false },
    ]);
  });

  it("references every Project that shares the key", () => {
    const { project, create } = setup();
    const a = project("A", "MAT");
    const b = project("B", "MAT");
    const ids = create("fix @mat").references.map((r) => r.projectId);
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it("flags a soft-deleted Project and clears the flag on Restore", () => {
    const { services, project, create } = setup();
    const crm = project("CRM", "CRM");
    const todo = create("Work on @CRM");
    services.trash.softDelete("you", "project", crm.id);
    expect(services.todos.get(todo.id).references).toEqual([
      { key: "CRM", projectId: crm.id, projectDeleted: true },
    ]);
    expect(services.todos.list({ state: "open" }).items[0]?.references).toEqual(
      [{ key: "CRM", projectId: crm.id, projectDeleted: true }],
    );
    services.trash.restore("you", "project", crm.id);
    expect(services.todos.get(todo.id).references[0]?.projectDeleted).toBe(
      false,
    );
  });

  it("matches a Project that is already deleted when the To-do is created", () => {
    const { services, project, create } = setup();
    const crm = project("CRM", "CRM");
    services.trash.softDelete("you", "project", crm.id);
    expect(create("@CRM").references).toEqual([
      { key: "CRM", projectId: crm.id, projectDeleted: true },
    ]);
  });

  it("returns the same references from create, get and list", () => {
    const { project, create, services } = setup();
    project("CRM", "CRM");
    project("Web", "WEB");
    const a = create("@crm");
    const b = create("plain");
    const c = create("@web @crm");
    expect(services.todos.get(a.id)).toEqual(a);
    expect(services.todos.get(c.id)).toEqual(c);
    expect(services.todos.list({ state: "open" }).items).toEqual([a, b, c]);
  });

  it("stores one todo_references row per Project", () => {
    const { sqlite, project, create } = setup();
    const crm = project("CRM", "CRM");
    const todo = create("@crm @CRM @Crm");
    expect(
      sqlite.prepare("SELECT todo_id, project_id FROM todo_references").all(),
    ).toEqual([{ todo_id: todo.id, project_id: crm.id }]);
  });

  it("re-derives, replacing the rows, when called again with a new title", () => {
    const { db, sqlite, project, create } = setup();
    project("CRM", "CRM");
    const web = project("Web", "WEB");
    const todo = create("@crm");
    db.transaction((tx) => {
      deriveReferences(tx, todo.id, "now @web only");
    });
    const rows = sqlite
      .prepare("SELECT project_id FROM todo_references WHERE todo_id = ?")
      .all(todo.id);
    expect(rows).toEqual([{ project_id: web.id }]);
  });

  it("prefers live Projects over deleted ones that share the key", () => {
    const { services, project, create } = setup();
    const old = project("Old", "BBVA");
    services.trash.softDelete("you", "project", old.id);
    const fresh = project("New", "BBVA");
    // The deleted one still matches while no live Project has the key.
    expect(create("@bbva").references.map((r) => r.projectId)).toEqual([
      fresh.id,
    ]);
    const only = project("Only", "ZED");
    services.trash.softDelete("you", "project", only.id);
    expect(create("@zed").references).toEqual([
      { key: "ZED", projectId: only.id, projectDeleted: true },
    ]);
  });

  it("drops the reference, not the To-do, when the Project is purged", async () => {
    const { services, project, create } = setup();
    const crm = project("CRM", "CRM");
    const todo = create("@crm");
    services.trash.softDelete("you", "project", crm.id);
    await services.trash.purge("you", "project", crm.id);
    expect(services.todos.get(todo.id)).toMatchObject({
      title: "@crm",
      references: [],
    });
  });
});
