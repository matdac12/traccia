import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { todos } from "../../src/db/schema.js";
import { code, setupServices } from "./helpers.js";

const DAY = "2026-10-20";

function setup() {
  const s = setupServices();
  const create = (title: string, day: string | null = DAY, parentId?: string) =>
    s.services.todos.create("you", "parla", { title, day, parentId });
  /** Titles of the open To-dos in one bucket, in `GET ?state=open` order. */
  const order = (day: string | null = DAY, parentId: string | null = null) =>
    s.services.todos
      .list({ state: "open", limit: 250 })
      .items.filter((t) => t.day === day && t.parentId === parentId)
      .map((t) => t.title);
  const move = (
    id: string,
    pos: {
      beforeId?: string;
      afterId?: string;
      expectedUpdatedAt?: string;
    } = {},
  ) => s.services.todos.move(id, pos);
  return { ...s, create, order, move };
}

describe("todos.move", () => {
  it("places a To-do between two others, at the top and at the bottom", () => {
    const { create, order, move } = setup();
    const a = create("a");
    const b = create("b");
    const c = create("c");
    const d = create("d");
    move(d.id, { afterId: a.id, beforeId: b.id });
    expect(order()).toEqual(["a", "d", "b", "c"]);
    move(c.id, { beforeId: a.id });
    expect(order()).toEqual(["c", "a", "d", "b"]);
    move(c.id, { afterId: b.id });
    expect(order()).toEqual(["a", "d", "b", "c"]);
    move(a.id);
    expect(order()).toEqual(["d", "b", "c", "a"]);
    move(b.id, { beforeId: d.id });
    expect(order()).toEqual(["b", "d", "c", "a"]);
  });

  it("uses a fractional midpoint, and 1024 steps at the ends", () => {
    const { create, move } = setup();
    const a = create("a");
    const b = create("b");
    expect([a.position, b.position]).toEqual([1024, 2048]);
    expect(move(b.id, { beforeId: a.id }).position).toBe(0);
    expect(move(a.id, { afterId: b.id }).position).toBe(1024);
    const c = create("c");
    expect(move(c.id, { afterId: b.id, beforeId: a.id }).position).toBe(512);
  });

  it("bumps updatedAt of the moved To-do only", () => {
    const { create, move, services } = setup();
    const a = create("a");
    const b = create("b");
    const moved = move(b.id, { beforeId: a.id });
    expect(moved.updatedAt >= b.updatedAt).toBe(true);
    expect(services.todos.get(a.id).updatedAt).toBe(a.updatedAt);
  });

  it("orders Sub-to-dos inside their own bucket", () => {
    const { create, order, move } = setup();
    const parent = create("parent");
    const s1 = create("s1", DAY, parent.id);
    create("s2", DAY, parent.id);
    move(s1.id);
    expect(order(DAY, parent.id)).toEqual(["s2", "s1"]);
    expect(order()).toEqual(["parent"]);
  });

  it("orders Anytime To-dos", () => {
    const { create, order, move } = setup();
    const a = create("a", null);
    create("b", null);
    move(a.id);
    expect(order(null)).toEqual(["b", "a"]);
  });

  it("moves a closed To-do inside its bucket", () => {
    const { create, services, order, move } = setup();
    const a = create("a");
    const b = create("b");
    services.todos.update(a.id, { state: "done" });
    move(a.id, { afterId: b.id });
    services.todos.update(a.id, { state: "open" });
    expect(order()).toEqual(["b", "a"]);
  });

  it.each([
    ["another day", (c: any) => c("x", "2026-10-21")],
    ["Anytime", (c: any) => c("x", null)],
  ])("refuses a neighbour on %s", (_, other) => {
    const { create, move, services } = setup();
    const a = create("a");
    const x = other(create);
    for (const key of ["beforeId", "afterId"] as const) {
      expect(code(() => move(a.id, { [key]: x.id }))).toBe("validation_error");
    }
    expect(services.todos.get(a.id).position).toBe(a.position);
  });

  it("refuses a neighbour under another parent, or a top-level one for a Sub-to-do", () => {
    const { create, move } = setup();
    const p1 = create("p1");
    const p2 = create("p2");
    const s1 = create("s1", DAY, p1.id);
    const s2 = create("s2", DAY, p2.id);
    expect(code(() => move(s1.id, { beforeId: s2.id }))).toBe(
      "validation_error",
    );
    expect(code(() => move(s1.id, { afterId: p2.id }))).toBe(
      "validation_error",
    );
    expect(code(() => move(p1.id, { afterId: s1.id }))).toBe(
      "validation_error",
    );
  });

  it("refuses a deleted, unknown or own neighbour, and non-adjacent before/after", () => {
    const { create, move, services, db } = setup();
    const a = create("a");
    const b = create("b");
    const c = create("c");
    const gone = create("gone");
    db.update(todos)
      .set({ deletedAt: "2026-10-17T10:00:00.000Z" })
      .where(eq(todos.id, gone.id))
      .run();
    expect(code(() => move(a.id, { beforeId: gone.id }))).toBe(
      "validation_error",
    );
    expect(code(() => move(a.id, { afterId: "nope" }))).toBe(
      "validation_error",
    );
    expect(code(() => move(a.id, { beforeId: a.id }))).toBe("validation_error");
    expect(code(() => move(a.id, { afterId: c.id, beforeId: b.id }))).toBe(
      "validation_error",
    );
    expect(services.todos.get(a.id).position).toBe(a.position);
  });

  it("is not_found for an unknown or deleted To-do", () => {
    const { create, move, db } = setup();
    expect(code(() => move("nope"))).toBe("not_found");
    const a = create("a");
    db.update(todos)
      .set({ deletedAt: "2026-10-17T10:00:00.000Z" })
      .where(eq(todos.id, a.id))
      .run();
    expect(code(() => move(a.id))).toBe("not_found");
  });

  it("returns conflict for a stale expectedUpdatedAt and leaves the row", () => {
    const { create, move, services } = setup();
    const a = create("a");
    const b = create("b");
    expect(
      code(() =>
        move(a.id, {
          afterId: b.id,
          expectedUpdatedAt: "1999-01-01T00:00:00.000Z",
        }),
      ),
    ).toBe("conflict");
    expect(services.todos.get(a.id)).toMatchObject({
      position: a.position,
      updatedAt: a.updatedAt,
    });
    expect(
      move(a.id, { afterId: b.id, expectedUpdatedAt: a.updatedAt }).id,
    ).toBe(a.id);
  });

  it("rebalances a collapsed gap, keeps the order and leaves updatedAt alone", () => {
    const { create, order, move, services, db } = setup();
    const a = create("a");
    const b = create("b");
    const c = create("c");
    const d = create("d");
    // a and b are 1e-7 apart: under the minimum gap.
    db.update(todos).set({ position: 10 }).where(eq(todos.id, a.id)).run();
    db.update(todos)
      .set({ position: 10.0000001 })
      .where(eq(todos.id, b.id))
      .run();
    const moved = move(d.id, { afterId: a.id, beforeId: b.id });
    expect(order()).toEqual(["a", "d", "b", "c"]);
    const rows = [a, d, b, c].map((t) => services.todos.get(t.id).position);
    expect(new Set(rows).size).toBe(4);
    expect(
      Math.min(...rows.slice(1).map((p, i) => p - rows[i]!)),
    ).toBeGreaterThan(1e-6);
    expect(moved.position).toBe(services.todos.get(d.id).position);
    for (const t of [a, b, c]) {
      expect(services.todos.get(t.id).updatedAt).toBe(t.updatedAt);
    }
  });

  it("keeps the order across 80 insertions between the same pair", () => {
    const { create, order, move } = setup();
    const first = create("first");
    create("last");
    const inserted: string[] = [];
    for (let i = 0; i < 80; i++) {
      const x = create(`x${i}`);
      move(x.id, { afterId: first.id });
      inserted.unshift(`x${i}`);
    }
    expect(order()).toEqual(["first", ...inserted, "last"]);
  });
});
