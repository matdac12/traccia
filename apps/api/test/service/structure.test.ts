import { describe, expect, it } from "vitest";
import { activity } from "../../src/db/schema.js";
import { code, setupServices } from "./helpers.js";

function setup() {
  const s = setupServices();
  const { projects, issues, milestones, relations } = s.services;
  const p1 = projects.create("you", { name: "P1" });
  const p2 = projects.create("you", { name: "P2" });
  const create = (input: Record<string, unknown> = {}) =>
    issues.create("agent", { project: p1.id, title: "T", ...input });
  const types = (issueId: string) =>
    s.db
      .select()
      .from(activity)
      .all()
      .filter((a) => a.issueId === issueId)
      .map((a) => a.type);
  return { ...s, p1, p2, create, types, issues, milestones, relations };
}

describe("sub-issues", () => {
  it("rejects a parent in another project", () => {
    const { create, issues, p2 } = setup();
    const a = create();
    const b = issues.create("you", { project: p2.id, title: "B" });
    expect(code(() => issues.update("you", b.id, { parentId: a.id }))).toBe(
      "validation_error",
    );
  });

  it("rejects self-parent and ancestor-as-child cycles", () => {
    const { create, issues } = setup();
    const a = create();
    const b = create({ parentId: a.id });
    expect(code(() => issues.update("you", a.id, { parentId: a.id }))).toBe(
      "validation_error",
    );
    expect(code(() => issues.update("you", a.id, { parentId: b.id }))).toBe(
      "validation_error",
    );
  });

  it("accepts depth 3 and rejects depth 4", () => {
    const { create, issues } = setup();
    const a = create();
    const b = create({ parentId: a.id });
    const c = create({ parentId: b.id });
    expect(code(() => create({ parentId: c.id }))).toBe("validation_error");
    const loose = create();
    expect(code(() => issues.update("you", loose.id, { parentId: c.id }))).toBe(
      "validation_error",
    );
  });

  it("counts the moved subtree toward depth", () => {
    const { create, issues } = setup();
    const a = create();
    const b = create({ parentId: a.id });
    const x = create();
    const y = create({ parentId: x.id });
    // x(+y) under b would make y level 4
    expect(code(() => issues.update("you", x.id, { parentId: b.id }))).toBe(
      "validation_error",
    );
    // x(+y) directly under a: y is level 3
    expect(issues.update("you", x.id, { parentId: a.id }).parentId).toBe(a.id);
    expect(issues.get(y.id).parentId).toBe(x.id);
  });

  it("sets and clears the parent with parent_changed activity", () => {
    const { create, issues, types } = setup();
    const a = create();
    const b = create();
    issues.update("you", b.id, { parentId: a.identifier });
    expect(issues.get(a.id, ["children"]).children.map((c) => c.id)).toEqual([
      b.id,
    ]);
    expect(issues.update("you", b.id, { parentId: null }).parentId).toBeNull();
    expect(types(b.id)).toEqual([
      "issue_created",
      "parent_changed",
      "parent_changed",
    ]);
  });
});

describe("blockers", () => {
  it("rejects self-relations and direct cycles", () => {
    const { create, relations } = setup();
    const a = create();
    const b = create();
    expect(code(() => relations.addBlocker("you", a.id, a.id))).toBe(
      "validation_error",
    );
    relations.addBlocker("you", a.id, b.id);
    expect(code(() => relations.addBlocker("you", b.id, a.id))).toBe(
      "validation_error",
    );
  });

  it("accepts cross-project blockers and reads both directions", () => {
    const { create, issues, relations, p2 } = setup();
    const a = create({ title: "A" });
    const b = issues.create("you", { project: p2.id, title: "B" });
    expect(relations.addBlocker("you", a.identifier, b.identifier)).toBe(true);
    expect(issues.get(b.id, ["relations"]).relations).toEqual({
      blockedBy: [
        {
          id: a.id,
          identifier: a.identifier,
          title: "A",
          status: "backlog",
        },
      ],
      blocks: [],
    });
    expect(
      issues.get(a.id, ["relations"]).relations.blocks.map((r) => r.id),
    ).toEqual([b.id]);
    expect(issues.get(a.id).relations).toEqual({ blockedBy: [], blocks: [] });
  });

  it("is idempotent without extra activity, on add and remove", () => {
    const { create, relations, types } = setup();
    const a = create();
    const b = create();
    expect(relations.addBlocker("you", a.id, b.id)).toBe(true);
    expect(relations.addBlocker("you", a.id, b.id)).toBe(false);
    expect(types(a.id)).toEqual(["issue_created", "blocker_added"]);
    expect(types(b.id)).toEqual(["issue_created", "blocker_added"]);
    expect(relations.removeBlocker("you", a.id, b.id)).toBe(true);
    expect(relations.removeBlocker("you", a.id, b.id)).toBe(false);
    expect(types(b.id)).toEqual([
      "issue_created",
      "blocker_added",
      "blocker_removed",
    ]);
  });

  it("hides deleted issues from relations", () => {
    const { create, issues, relations, sqlite } = setup();
    const a = create();
    const b = create();
    relations.addBlocker("you", a.id, b.id);
    sqlite.prepare("UPDATE issues SET deleted_at = 'x' WHERE id = ?").run(a.id);
    expect(issues.get(b.id, ["relations"]).relations.blockedBy).toEqual([]);
  });
});

describe("moving between projects", () => {
  it("keeps the identifier, clears parent/milestone, moves the subtree", () => {
    const { create, issues, milestones, relations, p1, p2, types } = setup();
    const m1 = milestones.create("you", p1.id, { name: "M1" });
    const root = create();
    const mid = create({ parentId: root.id, milestoneId: m1.id });
    const leaf = create({ parentId: mid.id, milestoneId: m1.id });
    const other = create();
    relations.addBlocker("you", other.id, mid.id);

    const moved = issues.update("you", mid.identifier, { project: p2.name });

    expect(moved).toMatchObject({
      identifier: mid.identifier,
      projectId: p2.id,
      parentId: null,
      milestoneId: null,
    });
    const leafAfter = issues.get(leaf.id);
    expect(leafAfter).toMatchObject({
      projectId: p2.id,
      parentId: mid.id,
      milestoneId: null,
      identifier: leaf.identifier,
    });
    expect(issues.get(root.id).projectId).toBe(p1.id);
    expect(types(mid.id)).toEqual([
      "issue_created",
      "blocker_added",
      "parent_changed",
      "milestone_changed",
      "project_changed",
    ]);
    expect(types(leaf.id)).toEqual([
      "issue_created",
      "project_changed",
      "milestone_changed",
    ]);
    // cross-project blocker survives the move
    expect(issues.get(mid.id, ["relations"]).relations.blockedBy).toHaveLength(
      1,
    );
    // a new milestone/parent valid in the target project can be given with the move
    const again = issues.update("you", leaf.id, { project: p1.id });
    expect(again.parentId).toBeNull();
    const withMs = issues.update("you", mid.id, {
      project: p1.id,
      milestoneId: milestones.create("you", p1.id, { name: "M3" }).id,
    });
    expect(withMs.milestoneId).not.toBeNull();
  });

  it("rolls back everything when the move is invalid", () => {
    const { create, issues, p2, types } = setup();
    const a = create();
    const b = create({ parentId: a.id });
    expect(
      code(() =>
        issues.update("you", b.id, { project: p2.id, milestoneId: "missing" }),
      ),
    ).toBe("not_found");
    expect(issues.get(b.id)).toMatchObject({ parentId: a.id });
    expect(types(b.id)).toEqual(["issue_created"]);
  });
});
