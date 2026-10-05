import { describe, expect, it } from "vitest";
import { issues } from "../../src/db/schema.js";
import { buildIssueListQuery } from "../../src/service/index.js";
import { code, setupServices } from "./helpers.js";

function setup() {
  const s = setupServices();
  const { services, db, sqlite } = s;
  const p1 = services.projects.create("you", { name: "P1" });
  const p2 = services.projects.create("you", { name: "P2" });
  const create = (input: Record<string, unknown> = {}) =>
    services.issues.create("agent", { project: p1.id, title: "T", ...input });
  const ids = (input: Parameters<typeof services.issues.list>[0] = {}) =>
    services.issues.list({ limit: 250, ...input }).items.map((i) => i.title);
  return { ...s, services, db, sqlite, p1, p2, create, ids };
}

describe("list filters", () => {
  it("filters each field alone", () => {
    const { create, ids, services, p1, p2 } = setup();
    const m = services.milestones.create("you", p1.id, { name: "Alpha" });
    services.labels.create({ name: "bug" });
    const parent = create({ title: "parent" });
    create({ title: "a", status: "todo", assignee: "you", priority: 1 });
    create({ title: "b", status: "done", milestoneId: m.id });
    create({ title: "c", parentId: parent.id });
    services.issues.create("you", { project: p2.id, title: "d" });
    const e = create({ title: "e" });
    services.issues.update("agent", e.id, { labels: ["bug"] });

    expect(ids({ project: p2.name })).toEqual(["d"]);
    expect(ids({ status: ["todo", "done"] }).sort()).toEqual(["a", "b"]);
    expect(ids({ status: "todo" as never })).toEqual(["a"]);
    expect(ids({ assignee: "you" })).toEqual(["a"]);
    expect(ids({ assignee: "none" })).toHaveLength(5);
    expect(ids({ label: ["BUG"] })).toEqual(["e"]);
    expect(ids({ milestone: "Alpha", project: p1.id })).toEqual(["b"]);
    expect(ids({ milestone: m.id })).toEqual(["b"]);
    expect(ids({ parent: parent.identifier })).toEqual(["c"]);
    expect(ids({ priority: "urgent" as never })).toEqual(["a"]);
    expect(ids({ createdBy: "you" })).toEqual(["d"]);
    expect(code(() => ids({ milestone: "Nope" }))).toBe("not_found");
  });

  it("ANDs filters, ORs statuses, ANDs labels", () => {
    const { create, ids, services } = setup();
    services.labels.create({ name: "x" });
    services.labels.create({ name: "y" });
    const a = create({ title: "a", status: "todo" });
    const b = create({ title: "b", status: "todo" });
    create({ title: "c", status: "done" });
    services.issues.update("agent", a.id, { labels: ["x", "y"] });
    services.issues.update("agent", b.id, { labels: ["x"] });
    expect(ids({ label: ["x", "y"] })).toEqual(["a"]);
    expect(ids({ label: ["x"], status: ["todo", "done"] }).sort()).toEqual([
      "a",
      "b",
    ]);
    expect(ids({ label: ["x"], status: ["done"] })).toEqual([]);
  });

  it("hides deleted unless asked and filters updatedAfter", async () => {
    const { create, ids, db } = setup();
    const a = create({ title: "a" });
    create({ title: "b" });
    db.update(issues)
      .set({ deletedAt: "2026-01-01T00:00:00.000Z" })
      .where(eqId(a.id))
      .run();
    expect(ids()).toEqual(["b"]);
    expect(ids({ includeDeleted: true }).sort()).toEqual(["a", "b"]);
    expect(ids({ updatedAfter: "2999-01-01T00:00:00.000Z" })).toEqual([]);
    expect(ids({ updatedAfter: "2000-01-01T00:00:00.000Z" })).toEqual(["b"]);
  });
});

import { eq } from "drizzle-orm";
const eqId = (id: string) => eq(issues.id, id);

describe("pagination", () => {
  for (const orderBy of [
    "updatedAt",
    "createdAt",
    "priority",
    "sortOrder",
  ] as const) {
    for (const order of ["asc", "desc"] as const) {
      it(`pages 600 rows without gaps or repeats (${orderBy} ${order})`, () => {
        const { services, create } = setup();
        const all = new Set<string>();
        for (let i = 0; i < 600; i++) {
          // Few distinct values -> heavy ties exercise the id tiebreaker.
          all.add(create({ priority: i % 5, sortOrder: i % 7 }).id);
        }
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
          const page = services.issues.list({
            orderBy,
            order,
            limit: 97,
            cursor,
          });
          seen.push(...page.items.map((i) => i.id));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        expect(seen).toHaveLength(600);
        expect(new Set(seen)).toEqual(all);
      });
    }
  }

  it("clamps limit and rejects foreign cursors", () => {
    const { services, create } = setup();
    create();
    const page = services.issues.list({ orderBy: "priority" });
    expect(page.nextCursor).toBeNull();
    for (let i = 0; i < 3; i++) create();
    const first = services.issues.list({ limit: 2, orderBy: "priority" });
    expect(
      code(() =>
        services.issues.list({
          cursor: first.nextCursor ?? "",
          orderBy: "createdAt",
        }),
      ),
    ).toBe("validation_error");
    expect(code(() => services.issues.list({ cursor: "!!" }))).toBe(
      "validation_error",
    );
    expect(code(() => services.issues.list({ limit: 0 }))).toBe(
      "validation_error",
    );
  });
});

describe("query plans", () => {
  const plan = (
    sqlite: import("better-sqlite3").Database,
    input: Parameters<typeof buildIssueListQuery>[1],
    db: Parameters<typeof buildIssueListQuery>[0],
  ) => {
    const { sql, params } = buildIssueListQuery(db, input).query.toSQL();
    return (
      sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as {
        detail: string;
      }[]
    )
      .map((r) => r.detail)
      .join("\n");
  };
  it("uses indexes for the common filters", () => {
    const { sqlite, db, p1, services } = setup();
    const m = services.milestones.create("you", p1.id, { name: "M" });
    expect(plan(sqlite, { project: p1.id, status: ["todo"] }, db)).toContain(
      "issues_project_status",
    );
    expect(plan(sqlite, { assignee: "you", status: ["todo"] }, db)).toContain(
      "issues_assignee",
    );
    expect(plan(sqlite, { updatedAfter: "2026-01-01T00:00:00.000Z" }, db)).toContain(
      "issues_updated",
    );
    expect(
      plan(sqlite, { parent: undefined, project: p1.id }, db),
    ).not.toContain("SCAN issues\n");
  });
});
