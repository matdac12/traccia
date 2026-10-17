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

describe("todos.create with parentId", () => {
  const fields = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as { details?: { fields?: Record<string, string[]> } }).details
        ?.fields;
    }
    return undefined;
  };

  it("creates a Sub-to-do at the bottom of its parent's bucket", () => {
    const { services } = setupServices();
    const parent = services.todos.create("you", "t", { title: "parent" });
    const a = services.todos.create("you", "t", {
      title: "a",
      parentId: parent.id,
    });
    const b = services.todos.create("you", "t", {
      title: "b",
      day: "2026-10-20",
      parentId: parent.id,
    });
    const c = services.todos.create("you", "t", {
      title: "c",
      parentId: parent.id,
    });
    expect(a).toMatchObject({ parentId: parent.id, day: null, state: "open" });
    expect(b.day).toBe("2026-10-20");
    // Same bucket (Anytime under this parent): c is below a. b starts afresh.
    expect(c.position).toBeGreaterThan(a.position);
    expect(b.position).toBe(a.position);
  });

  it("gives a Sub-to-do only the references its own title names", () => {
    const { services } = setupServices();
    services.projects.create("you", { name: "CRM", key: "CRM" });
    const parent = services.todos.create("you", "t", { title: "@crm plan" });
    const sub = services.todos.create("you", "t", {
      title: "write it",
      parentId: parent.id,
    });
    expect(parent.references).toHaveLength(1);
    expect(sub.references).toEqual([]);
  });

  it("refuses a missing, nested, closed or deleted parent as a 400 on parentId", () => {
    const { services, sqlite } = setupServices();
    const make = (title: string, parentId?: string) =>
      services.todos.create("you", "t", { title, parentId });
    const top = make("top");
    const sub = make("sub", top.id);
    const closed = make("closed");
    const gone = make("gone");
    sqlite
      .prepare("UPDATE todos SET state = 'done', closed_at = ? WHERE id = ?")
      .run("2026-10-17T09:00:00.000Z", closed.id);
    sqlite
      .prepare("UPDATE todos SET deleted_at = ? WHERE id = ?")
      .run("2026-10-17T12:00:00.000Z", gone.id);
    for (const parentId of ["nope", sub.id, closed.id, gone.id]) {
      const run = () => make("child", parentId);
      expect(code(run)).toBe("validation_error");
      expect(fields(run)?.parentId).toHaveLength(1);
    }
    // Nothing was created by the refused calls.
    expect(services.todos.list({ state: "open" }).items).toHaveLength(2);
  });
});

describe("todos.update", () => {
  function setup() {
    const t = setupServices();
    const create = (
      title: string,
      extra: { day?: string; parentId?: string } = {},
    ) => t.services.todos.create("you", "t", { title, ...extra });
    const update = (
      id: string,
      patch: Parameters<typeof t.services.todos.update>[1],
    ) => t.services.todos.update(id, patch);
    return { ...t, create, update };
  }
  const details = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as { details?: Record<string, unknown> }).details;
    }
    return undefined;
  };

  it("edits title and Details, and bumps updatedAt", async () => {
    const { create, update } = setup();
    const todo = create("old");
    await new Promise((r) => setTimeout(r, 5));
    const updated = update(todo.id, { title: "  new ", details: "# notes" });
    expect(updated).toMatchObject({ title: "new", details: "# notes" });
    expect(updated.updatedAt > todo.updatedAt).toBe(true);
    expect(updated.createdAt).toBe(todo.createdAt);
    expect(update(todo.id, { details: "" }).details).toBeNull();
  });

  it("re-derives references on a title change, in the same write", () => {
    const { services, create, update } = setup();
    const crm = services.projects.create("you", { name: "CRM", key: "CRM" });
    const bbva = services.projects.create("you", { name: "BBVA", key: "BBVA" });
    const todo = create("plain");
    expect(update(todo.id, { title: "do @crm" }).references).toEqual([
      { key: "CRM", projectId: crm.id, projectDeleted: false },
    ]);
    expect(
      update(todo.id, { title: "do @bbva and @crm" }).references.map(
        (r) => r.projectId,
      ),
    ).toEqual([bbva.id, crm.id]);
    expect(update(todo.id, { title: "nothing" }).references).toEqual([]);
    expect(services.todos.get(todo.id).references).toEqual([]);
    // Details are not scanned.
    expect(update(todo.id, { details: "@crm" }).references).toEqual([]);
  });

  it("leaves references and updatedAt alone when nothing changes", () => {
    const { services, create, update } = setup();
    services.projects.create("you", { name: "CRM", key: "CRM" });
    const todo = create("do @crm", { day: "2026-10-20" });
    const same = update(todo.id, {
      title: "do @crm",
      day: "2026-10-20",
      state: "open",
    });
    expect(same).toEqual(todo);
  });

  it("moves the To-do to the bottom of its new bucket when the day changes", () => {
    const { create, update } = setup();
    const a = create("a", { day: "2026-10-20" });
    const b = create("b", { day: "2026-10-20" });
    const c = create("c", { day: "2026-10-21" });
    const moved = update(a.id, { day: "2026-10-21" });
    expect(moved.day).toBe("2026-10-21");
    expect(moved.position).toBeGreaterThan(c.position);
    // The old bucket is untouched.
    expect(b.position).toBeGreaterThan(a.position);
    // Anytime is a bucket too.
    const any1 = create("any1");
    const anytime = update(b.id, { day: null });
    expect(anytime.day).toBeNull();
    expect(anytime.position).toBeGreaterThan(any1.position);
  });

  it("keeps the Position when the day is sent unchanged", () => {
    const { create, update } = setup();
    const a = create("a", { day: "2026-10-20" });
    create("b", { day: "2026-10-20" });
    expect(update(a.id, { day: "2026-10-20" }).position).toBe(a.position);
  });

  it("moves a Sub-to-do to the bottom of its day under the same parent", () => {
    const { create, update } = setup();
    const parent = create("parent");
    const s1 = create("s1", { parentId: parent.id });
    const s2 = create("s2", { parentId: parent.id });
    expect(update(s1.id, { day: null }).position).toBe(s1.position);
    const moved = update(s1.id, { day: "2026-10-20" });
    expect(moved.parentId).toBe(parent.id);
    expect(moved.position).toBe(s1.position); // first of its new bucket
    expect(s2.position).toBeGreaterThan(s1.position);
  });

  it("refuses an empty patch, a bad title or day, and an unknown or deleted To-do", () => {
    const { sqlite, create, update } = setup();
    const todo = create("a");
    expect(code(() => update(todo.id, {}))).toBe("validation_error");
    expect(code(() => update(todo.id, { closeSubTodos: true }))).toBe(
      "validation_error",
    );
    expect(
      code(() => update(todo.id, { expectedUpdatedAt: todo.updatedAt })),
    ).toBe("validation_error");
    expect(code(() => update(todo.id, { title: " " }))).toBe(
      "validation_error",
    );
    expect(code(() => update(todo.id, { day: "2026-02-30" }))).toBe(
      "validation_error",
    );
    expect(code(() => update("nope", { title: "x" }))).toBe("not_found");
    sqlite
      .prepare("UPDATE todos SET deleted_at = ? WHERE id = ?")
      .run("2026-10-17T12:00:00.000Z", todo.id);
    expect(code(() => update(todo.id, { title: "x" }))).toBe("not_found");
  });

  it("is a conflict, with the current updatedAt, when expectedUpdatedAt is stale", async () => {
    const { services, create, update } = setup();
    const todo = create("a");
    await new Promise((r) => setTimeout(r, 5));
    const first = update(todo.id, {
      title: "b",
      expectedUpdatedAt: todo.updatedAt,
    });
    const stale = () =>
      update(todo.id, { title: "c", expectedUpdatedAt: todo.updatedAt });
    expect(code(stale)).toBe("conflict");
    expect(details(stale)).toEqual({ currentUpdatedAt: first.updatedAt });
    expect(services.todos.get(todo.id).title).toBe("b");
    expect(
      update(todo.id, { title: "c", expectedUpdatedAt: first.updatedAt }).title,
    ).toBe("c");
  });
});

describe("todos.update: closing and reopening", () => {
  function setup() {
    const t = setupServices();
    const create = (title: string, parentId?: string) =>
      t.services.todos.create("you", "t", { title, parentId });
    const update = (
      id: string,
      patch: Parameters<typeof t.services.todos.update>[1],
    ) => t.services.todos.update(id, patch);
    const get = (id: string) => t.services.todos.get(id);
    return { ...t, create, update, get };
  }
  const details = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as { details?: Record<string, unknown> }).details;
    }
    return undefined;
  };

  it("sets closed_at when closing and clears it when reopening", () => {
    const { create, update } = setup();
    const todo = create("a");
    const done = update(todo.id, { state: "done" });
    expect(done).toMatchObject({ state: "done" });
    expect(done.closedAt).toBe(done.updatedAt);
    const reopened = update(todo.id, { state: "open" });
    expect(reopened).toMatchObject({ state: "open", closedAt: null });
    expect(update(todo.id, { state: "dropped" }).state).toBe("dropped");
  });

  it("shows closed To-dos in the Logbook, newest closed first, Sub-to-dos included", async () => {
    const { services, create, update } = setup();
    const parent = create("parent");
    const sub = create("sub", parent.id);
    const other = create("other");
    update(other.id, { state: "done" });
    await new Promise((r) => setTimeout(r, 5));
    update(parent.id, { state: "dropped", closeSubTodos: true });
    const logbook = services.todos.list({ state: "closed" }).items;
    // The parent and its Sub-to-do closed together, after `other`.
    expect(
      logbook
        .map((t) => t.id)
        .slice(0, 2)
        .sort(),
    ).toEqual([parent.id, sub.id].sort());
    expect(logbook.map((t) => [t.title, t.state]).slice(2)).toEqual([
      ["other", "done"],
    ]);
    expect(logbook.slice(0, 2).map((t) => t.state)).toEqual([
      "dropped",
      "dropped",
    ]);
    expect(services.todos.list({ state: "open" }).items).toEqual([]);
  });

  it("refuses to close a parent with open Sub-to-dos without closeSubTodos, and changes nothing", () => {
    const { create, update, get } = setup();
    const parent = create("parent");
    const s1 = create("s1", parent.id);
    const s2 = create("s2", parent.id);
    const attempt = () =>
      update(parent.id, { state: "done", title: "renamed" });
    expect(code(attempt)).toBe("conflict");
    expect(details(attempt)).toEqual({ openSubTodos: 2 });
    expect(
      code(() => update(parent.id, { state: "done", closeSubTodos: false })),
    ).toBe("conflict");
    expect(get(parent.id)).toEqual({
      ...parent,
      subTodos: { done: 0, total: 2 },
    });
    expect(get(s1.id)).toEqual(s1);
    expect(get(s2.id)).toEqual(s2);
  });

  it("closes the parent and its open Sub-to-dos together with closeSubTodos", () => {
    const { create, update, get } = setup();
    const parent = create("parent");
    const s1 = create("s1", parent.id);
    const s2 = create("s2", parent.id);
    const stranger = create("stranger");
    const done = update(parent.id, { state: "done", closeSubTodos: true });
    expect(done.closedAt).not.toBeNull();
    for (const id of [s1.id, s2.id]) {
      expect(get(id)).toMatchObject({ state: "done", closedAt: done.closedAt });
    }
    expect(get(stranger.id)).toEqual(stranger);
  });

  it("drops the open Sub-to-dos when dropping, and leaves done and deleted ones alone", () => {
    const { sqlite, create, update, get } = setup();
    const parent = create("parent");
    const open = create("open", parent.id);
    const finished = create("finished", parent.id);
    const gone = create("gone", parent.id);
    const finishedDone = update(finished.id, { state: "done" });
    sqlite
      .prepare("UPDATE todos SET deleted_at = ? WHERE id = ?")
      .run("2026-10-17T12:00:00.000Z", gone.id);
    const dropped = update(parent.id, {
      state: "dropped",
      closeSubTodos: true,
    });
    expect(get(open.id)).toMatchObject({
      state: "dropped",
      closedAt: dropped.closedAt,
    });
    expect(get(finished.id)).toEqual(finishedDone);
    expect(get(gone.id)).toMatchObject({ state: "open", deleted: true });
  });

  it("counts only open, live Sub-to-dos; a parent with none closes without the flag", () => {
    const { create, update } = setup();
    const parent = create("parent");
    const sub = create("sub", parent.id);
    update(sub.id, { state: "done" });
    expect(update(parent.id, { state: "done" }).state).toBe("done");
  });

  it("closes a Sub-to-do on its own without touching its parent", () => {
    const { create, update, get } = setup();
    const parent = create("parent");
    const sub = create("sub", parent.id);
    expect(update(sub.id, { state: "done" }).state).toBe("done");
    // Only the count moves; the parent itself is untouched.
    expect(get(parent.id)).toEqual({
      ...parent,
      subTodos: { done: 1, total: 1 },
    });
  });

  it("reopens a parent without touching its Sub-to-dos", () => {
    const { create, update, get } = setup();
    const parent = create("parent");
    const sub = create("sub", parent.id);
    update(parent.id, { state: "done", closeSubTodos: true });
    const closedSub = get(sub.id);
    const reopened = update(parent.id, { state: "open" });
    expect(reopened).toMatchObject({ state: "open", closedAt: null });
    expect(get(sub.id)).toEqual(closedSub);
  });

  it("checks expectedUpdatedAt before the open Sub-to-do conflict", async () => {
    const { create, update } = setup();
    const parent = create("parent");
    create("sub", parent.id);
    await new Promise((r) => setTimeout(r, 5));
    update(parent.id, { title: "renamed" });
    const attempt = () =>
      update(parent.id, { state: "done", expectedUpdatedAt: parent.updatedAt });
    expect(code(attempt)).toBe("conflict");
    expect(details(attempt)).toHaveProperty("currentUpdatedAt");
    expect(details(attempt)).not.toHaveProperty("openSubTodos");
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

  it("counts an @KEY only at the start of the title or after a non-alphanumeric", () => {
    const { project, create } = setup();
    project("CRM", "CRM");
    for (const title of [
      "bob@crm.com",
      "mail bob@crm.com now",
      "x1@crm",
      "è@crm",
    ]) {
      expect(create(title).references).toEqual([]);
    }
    for (const title of [
      "@crm first",
      "(@crm)",
      "x,@crm",
      "see\n@crm",
      "a-@crm",
    ]) {
      expect(create(title).references.map((r) => r.key)).toEqual(["CRM"]);
    }
    // One preceded and one free occurrence of the same key is still one reference.
    expect(create("bob@crm.com and @crm").references).toHaveLength(1);
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
