import { ServiceError } from "@linear-matti/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activity } from "../../src/db/schema.js";
import { code, setupServices } from "./helpers.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

function setup() {
  const s = setupServices();
  const project = s.services.projects.create("you", { name: "P" });
  const create = (input: Record<string, unknown> = {}) =>
    s.services.issues.create("agent", {
      project: project.id,
      title: "T",
      ...input,
    });
  const rows = (issueId: string) =>
    s.db
      .select()
      .from(activity)
      .all()
      .filter((a) => a.issueId === issueId);
  const tick = (ms = 1000) => vi.advanceTimersByTime(ms);
  return { ...s, project, create, rows, tick };
}

describe("create issue", () => {
  it("allocates identifiers, applies defaults, stamps actor, writes issue_created", () => {
    const { create, rows, project } = setup();
    const a = create();
    const b = create();
    expect(a).toMatchObject({
      identifier: "MAT-1",
      projectId: project.id,
      status: "backlog",
      priority: 0,
      estimate: null,
      assignee: null,
      description: "",
      createdBy: "agent",
      startedAt: null,
      completedAt: null,
    });
    expect(b.identifier).toBe("MAT-2");
    expect(rows(a.id).map((r) => [r.type, r.actor])).toEqual([
      ["issue_created", "agent"],
    ]);
  });

  it("sets completed_at when created done", () => {
    const { create } = setup();
    expect(create({ status: "Done" }).completedAt).toBe(
      "2026-10-04T10:00:00.000Z",
    );
  });

  it("rejects invalid input with validation_error", () => {
    const { create } = setup();
    for (const bad of [
      { title: " " },
      { status: "nope" },
      { priority: 5 },
      { priority: "asap" },
      { estimate: -1 },
      { estimate: 1.5 },
      { assignee: "bob" },
    ]) {
      expect(code(() => create(bad))).toBe("validation_error");
    }
  });

  it("rolls back the counter when creation fails", () => {
    const { create } = setup();
    expect(code(() => create({ milestoneId: "missing" }))).toBe("not_found");
    expect(create().identifier).toBe("MAT-1");
  });

  it("accepts a parent in the same project only", () => {
    const { create, services } = setup();
    const parent = create();
    expect(create({ parentId: parent.identifier }).parentId).toBe(parent.id);
    const other = services.projects.create("you", { name: "Q" });
    expect(
      code(() =>
        services.issues.create("you", {
          project: other.id,
          title: "x",
          parentId: parent.id,
        }),
      ),
    ).toBe("validation_error");
  });
});

describe("status", () => {
  it.each([
    "in_progress",
    "In Progress",
    "in-progress",
    "IN_PROGRESS",
    " in progress ",
  ])("accepts spelling %j", (spelling) => {
    const { create, services } = setup();
    const i = create();
    expect(
      services.issues.update("you", i.id, { status: spelling }).status,
    ).toBe("in_progress");
  });

  it("accepts every display name", () => {
    const { create, services } = setup();
    const i = create();
    for (const [name, value] of [
      ["Backlog", "backlog"],
      ["Todo", "todo"],
      ["In Progress", "in_progress"],
      ["In Review", "in_review"],
      ["Done", "done"],
      ["Canceled", "canceled"],
    ]) {
      expect(services.issues.update("you", i.id, { status: name }).status).toBe(
        value,
      );
    }
  });

  it("rejects unknown status", () => {
    const { create, services } = setup();
    const i = create();
    expect(
      code(() => services.issues.update("you", i.id, { status: "wip" })),
    ).toBe("validation_error");
  });

  it("applies timestamp side effects across transitions", () => {
    const { create, services, tick } = setup();
    const i = create();
    const set = (status: string) =>
      services.issues.update("you", i.id, { status });

    const t0 = "2026-10-04T10:00:00.000Z";
    tick();
    const t1 = "2026-10-04T10:00:01.000Z";
    expect(set("in_progress")).toMatchObject({
      startedAt: t1,
      completedAt: null,
      canceledAt: null,
    });
    tick();
    const t2 = "2026-10-04T10:00:02.000Z";
    expect(set("done")).toMatchObject({
      startedAt: t1,
      completedAt: t2,
      canceledAt: null,
    });
    tick();
    // done -> in_review clears completed_at, keeps started_at
    expect(set("in_review")).toMatchObject({
      startedAt: t1,
      completedAt: null,
    });
    tick();
    // done -> canceled swaps the timestamps
    set("done");
    tick();
    const t5 = "2026-10-04T10:00:05.000Z";
    expect(set("canceled")).toMatchObject({
      completedAt: null,
      canceledAt: t5,
    });
    tick();
    expect(set("todo")).toMatchObject({ canceledAt: null, completedAt: null });
    // re-entering in_progress keeps the original started_at
    tick();
    expect(set("in_progress").startedAt).toBe(t1);
    expect(t0).toBeTruthy();
  });

  it("sets started_at when first moving to in_progress from backlog", () => {
    const { create, services, tick } = setup();
    const i = create();
    tick();
    expect(
      services.issues.update("you", i.id, { status: "in_progress" }).startedAt,
    ).toBe("2026-10-04T10:00:01.000Z");
  });
});

describe("priority, estimate, assignee", () => {
  it.each([
    [0, 0],
    [1, 1],
    [4, 4],
    ["0", 0],
    ["urgent", 1],
    ["High", 2],
    ["MEDIUM", 3],
    ["low", 4],
    ["none", 0],
  ])("accepts priority %j", (input, expected) => {
    const { create, services } = setup();
    const i = create({ priority: 3 });
    expect(
      services.issues.update("you", i.id, { priority: input as never })
        .priority,
    ).toBe(expected);
  });

  it("rejects out-of-range priority", () => {
    const { create, services } = setup();
    const i = create();
    for (const priority of [-1, 5, 1.5, "9", "x", null]) {
      expect(
        code(() =>
          services.issues.update("you", i.id, { priority: priority as never }),
        ),
      ).toBe("validation_error");
    }
  });

  it("sets and clears estimate and assignee", () => {
    const { create, services, tick } = setup();
    const i = create({ estimate: 3, assignee: "you" });
    tick();
    const u = services.issues.update("you", i.id, {
      estimate: null,
      assignee: "agent",
    });
    expect(u).toMatchObject({ estimate: null, assignee: "agent" });
    tick();
    expect(
      services.issues.update("you", i.id, { assignee: null }).assignee,
    ).toBe(null);
    expect(services.issues.update("you", i.id, { estimate: 0 }).estimate).toBe(
      0,
    );
  });
});

describe("update activity rows", () => {
  it("writes one row per changed field and none for unchanged ones", () => {
    const { create, services, rows, tick } = setup();
    const i = create({ title: "Old", priority: 2, estimate: 1 });
    tick();
    services.issues.update("you", i.id, {
      title: "New",
      description: "body",
      status: "todo",
      priority: 2, // unchanged
      estimate: 5,
      assignee: "agent",
    });
    const types = rows(i.id)
      .map((r) => r.type)
      .sort();
    expect(types).toEqual(
      [
        "issue_created",
        "title_changed",
        "description_changed",
        "status_changed",
        "estimate_changed",
        "assignee_changed",
      ].sort(),
    );
    const byType = Object.fromEntries(
      rows(i.id).map((r) => [r.type, JSON.parse(r.data)]),
    );
    expect(byType.status_changed).toEqual({ from: "backlog", to: "todo" });
    expect(byType.title_changed).toEqual({ from: "Old", to: "New" });
    expect(byType.estimate_changed).toEqual({ from: 1, to: 5 });
  });

  it("writes nothing and keeps updated_at for a no-op update", () => {
    const { create, services, rows, tick } = setup();
    const i = create({ title: "A" });
    tick();
    const u = services.issues.update("you", i.id, {
      title: "A",
      status: "backlog",
    });
    expect(u.updatedAt).toBe(i.updatedAt);
    expect(rows(i.id)).toHaveLength(1);
  });

  it("stores no description text, only a marker and old length", () => {
    const { create, services, rows } = setup();
    const i = create({ description: "secret old text" });
    services.issues.update("you", i.id, { description: "secret new text" });
    const row = rows(i.id).find((r) => r.type === "description_changed");
    expect(JSON.parse(row?.data ?? "")).toEqual({ oldLength: 15 });
    expect(row?.data).not.toContain("secret");
  });

  it("records the actor of the update", () => {
    const { create, services, rows } = setup();
    const i = create();
    services.issues.update("you", i.id, { priority: 1 });
    expect(rows(i.id).find((r) => r.type === "priority_changed")?.actor).toBe(
      "you",
    );
  });

  it("does not write activity for sort_order but does update it", () => {
    const { create, services, rows, tick } = setup();
    const i = create();
    tick();
    expect(
      services.issues.update("you", i.id, { sortOrder: 2.5 }).sortOrder,
    ).toBe(2.5);
    expect(rows(i.id)).toHaveLength(1);
  });

  it("rolls back field changes when the milestone is rejected", () => {
    const { create, services, rows } = setup();
    const i = create({ title: "A" });
    expect(
      code(() =>
        services.issues.update("you", i.id, { title: "B", milestoneId: "x" }),
      ),
    ).toBe("not_found");
    expect(services.issues.get(i.id).title).toBe("A");
    expect(rows(i.id)).toHaveLength(1);
  });
});

describe("milestones", () => {
  it("accepts a milestone of the issue's project and logs milestone_changed", () => {
    const { create, services, project, rows } = setup();
    const m = services.milestones.create("you", project.id, { name: "M" });
    const i = create();
    const u = services.issues.update("you", i.id, { milestoneId: m.id });
    expect(u.milestoneId).toBe(m.id);
    expect(
      JSON.parse(
        rows(i.id).find((r) => r.type === "milestone_changed")?.data ?? "",
      ),
    ).toEqual({ from: null, to: m.id });
    expect(
      services.issues.update("you", i.id, { milestoneId: null }).milestoneId,
    ).toBe(null);
  });

  it("rejects a milestone from another project on create and update", () => {
    const { create, services, rows } = setup();
    const other = services.projects.create("you", { name: "Q" });
    const m = services.milestones.create("you", other.id, { name: "M" });
    expect(code(() => create({ milestoneId: m.id }))).toBe("validation_error");
    const i = create();
    expect(
      code(() => services.issues.update("you", i.id, { milestoneId: m.id })),
    ).toBe("validation_error");
    expect(services.issues.get(i.id).milestoneId).toBeNull();
    expect(rows(i.id)).toHaveLength(1);
  });
});

describe("optimistic concurrency", () => {
  it("accepts a matching expectedUpdatedAt", () => {
    const { create, services, tick } = setup();
    const i = create();
    tick();
    const u = services.issues.update("you", i.id, {
      title: "X",
      expectedUpdatedAt: i.updatedAt,
    });
    expect(u.title).toBe("X");
    expect(u.updatedAt).not.toBe(i.updatedAt);
  });

  it("rejects a stale expectedUpdatedAt with conflict and leaves the row unchanged", () => {
    const { create, services, rows, tick } = setup();
    const i = create({ title: "A" });
    tick();
    services.issues.update("you", i.id, { title: "B" });
    tick();
    let err: unknown;
    try {
      services.issues.update("agent", i.id, {
        title: "C",
        expectedUpdatedAt: i.updatedAt,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe("conflict");
    expect(services.issues.get(i.id).title).toBe("B");
    expect(rows(i.id)).toHaveLength(2);
  });
});

describe("get", () => {
  it("finds by identifier (any case) or ULID, 404 otherwise", () => {
    const { create, services } = setup();
    const i = create();
    expect(services.issues.get("MAT-1").id).toBe(i.id);
    expect(services.issues.get("mat-1").id).toBe(i.id);
    expect(services.issues.get(i.id).id).toBe(i.id);
    expect(code(() => services.issues.get("MAT-99"))).toBe("not_found");
  });

  it("returns empty collections by default and activity/children on include", () => {
    const { create, services } = setup();
    const parent = create();
    const child = create({ parentId: parent.id });
    const plain = services.issues.get(parent.id);
    expect(plain).toMatchObject({
      comments: [],
      activity: [],
      attachments: [],
      children: [],
      relations: { blockedBy: [], blocks: [] },
    });
    const full = services.issues.get(parent.identifier, [
      "activity",
      "children",
      "comments",
    ]);
    expect(full.activity.map((a) => a.type)).toEqual(["issue_created"]);
    expect(full.children.map((c) => c.id)).toEqual([child.id]);
  });
});

describe("update hook", () => {
  it("runs inside the transaction and bumps updated_at when it reports a change", () => {
    const { create, services, tick } = setup();
    const i = create();
    tick();
    const seen: string[] = [];
    const u = services.issues.update("you", i.id, {}, (_tx, issue, actor) => {
      seen.push(`${issue.id}:${actor}`);
      return true;
    });
    expect(seen).toEqual([`${i.id}:you`]);
    expect(u.updatedAt).toBe("2026-10-04T10:00:01.000Z");
  });

  it("rolls back field changes when the hook throws", () => {
    const { create, services } = setup();
    const i = create({ title: "A" });
    expect(
      code(() =>
        services.issues.update("you", i.id, { title: "B" }, () => {
          throw new ServiceError("not_found", "label");
        }),
      ),
    ).toBe("not_found");
    expect(services.issues.get(i.id).title).toBe("A");
  });
});

describe("update labels", () => {
  it("writes label activity in the same transaction as the update", () => {
    const { services, create, rows, tick } = setup();
    services.labels.create({ name: "bug" });
    services.labels.create({ name: "chore" });
    const i = create();
    tick();
    const u = services.issues.update("you", i.id, {
      title: "New",
      labels: ["Bug", "chore"],
    });
    expect(u.updatedAt).not.toBe(i.updatedAt);
    expect(rows(i.id).map((a) => a.type)).toEqual([
      "issue_created",
      "title_changed",
      "label_added",
      "label_added",
    ]);
    // Unchanged set: no rows, no updatedAt bump.
    tick();
    const same = services.issues.update("you", i.id, {
      labels: ["bug", "chore"],
    });
    expect(same.updatedAt).toBe(u.updatedAt);
    expect(rows(i.id)).toHaveLength(4);
    services.issues.update("you", i.id, { labels: ["bug"] });
    expect(rows(i.id).at(-1)?.type).toBe("label_removed");
  });

  it("rolls back the whole update when a label is unknown", () => {
    const { services, create, rows } = setup();
    services.labels.create({ name: "bug" });
    const i = create();
    expect(
      code(() =>
        services.issues.update("you", i.id, { title: "X", labels: ["bugg"] }),
      ),
    ).toBe("validation_error");
    expect(services.issues.get(i.id).title).toBe("T");
    expect(rows(i.id).map((a) => a.type)).toEqual(["issue_created"]);
  });
});
