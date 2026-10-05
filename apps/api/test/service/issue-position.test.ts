import { describe, expect, it } from "vitest";
import { activity } from "../../src/db/schema.js";
import { code, setupServices } from "./helpers.js";

function setup() {
  const s = setupServices();
  const project = s.services.projects.create("you", { name: "P" });
  const create = (title: string, status = "todo") =>
    s.services.issues.create("agent", { project: project.id, title, status });
  const column = (status = "todo") =>
    s.services.issues
      .list({
        project: project.id,
        status: [status] as never,
        orderBy: "sortOrder",
        order: "asc",
        limit: 250,
      })
      .items.map((i) => i.title);
  const move = (
    id: string,
    status: string,
    pos: { beforeId?: string; afterId?: string } = {},
  ) => s.services.issues.move("you", { identifier: id, status, ...pos });
  return { ...s, project, create, column, move };
}

describe("moveIssuePosition expectedUpdatedAt", () => {
  it("moves when fresh and returns conflict (row unchanged) when stale", () => {
    const { services, create, column, move } = setup();
    const a = create("a");
    const b = create("b");
    expect(
      code(() =>
        services.issues.move("you", {
          identifier: b.id,
          status: "done",
          expectedUpdatedAt: "1999-01-01T00:00:00.000Z",
        }),
      ),
    ).toBe("conflict");
    expect(services.issues.get(b.id)).toMatchObject({
      status: "todo",
      updatedAt: b.updatedAt,
      sortOrder: b.sortOrder,
    });
    const ok = services.issues.move("you", {
      identifier: b.id,
      status: "todo",
      afterId: a.id,
      expectedUpdatedAt: b.updatedAt,
    });
    expect(ok.id).toBe(b.id);
    expect(column()).toEqual(["a", "b"]);
    void move;
  });
});

describe("moveIssuePosition", () => {
  it("places between two items, at top, at bottom", () => {
    const { create, column, move } = setup();
    const a = create("a");
    const b = create("b");
    const c = create("c");
    const d = create("d");
    // Fresh issues all share sortOrder 0: first move normalises ties.
    move(c.id, "todo", { afterId: a.id });
    expect(column()).toEqual(["a", "c", "b", "d"]);
    move(d.id, "todo", { beforeId: a.id });
    expect(column()).toEqual(["d", "a", "c", "b"]);
    move(d.id, "todo");
    expect(column()).toEqual(["a", "c", "b", "d"]);
    move(b.id, "todo", { afterId: a.id, beforeId: c.id } as never);
    expect(column()).toEqual(["a", "b", "c", "d"]);
  });

  it("rejects non-adjacent or foreign neighbours", () => {
    const { create, move } = setup();
    const a = create("a");
    create("b");
    const c = create("c");
    const other = create("o", "done");
    expect(
      code(() => move(c.id, "todo", { afterId: a.id, beforeId: c.id })),
    ).toBe("validation_error");
    expect(code(() => move(a.id, "todo", { beforeId: other.id }))).toBe(
      "validation_error",
    );
    expect(code(() => move(a.id, "todo", { beforeId: a.id }))).toBe(
      "validation_error",
    );
  });

  it("changes status across columns with side effects and activity", () => {
    const { create, column, move, db } = setup();
    const a = create("a", "todo");
    const b = create("b", "in_progress");
    const moved = move(a.id, "in_progress", { beforeId: b.id });
    expect(moved.status).toBe("in_progress");
    expect(moved.startedAt).not.toBeNull();
    expect(column("in_progress")).toEqual(["a", "b"]);
    expect(column("todo")).toEqual([]);
    const rows = db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.issueId === a.id);
    expect(rows.map((r) => r.type)).toEqual([
      "issue_created",
      "status_changed",
    ]);
    const done = move(a.id, "done");
    expect(done.completedAt).not.toBeNull();
  });

  it("rebalances after >50 insertions between the same pair", () => {
    const { create, column, move, services } = setup();
    const first = create("first");
    const last = create("last");
    move(first.id, "todo");
    move(last.id, "todo");
    const inserted: string[] = [];
    for (let i = 0; i < 80; i++) {
      const x = create(`x${i}`);
      move(x.id, "todo", { afterId: first.id, beforeId: undefined });
      inserted.unshift(`x${i}`);
    }
    expect(column()).toEqual(["first", ...inserted, "last"]);
    const orders = services.issues
      .list({
        project: undefined,
        orderBy: "sortOrder",
        order: "asc",
        limit: 250,
      })
      .items.map((i) => i.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
    // The gap must have collapsed at least once, so the column was renumbered.
    expect(
      Math.min(
        ...orders.map((o, i) => (i ? o - (orders[i - 1] as number) : Infinity)),
      ),
    ).toBeGreaterThan(1e-6);
  });
});
