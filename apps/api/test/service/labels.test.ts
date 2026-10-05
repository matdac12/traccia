import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { activity, issueLabels, issues } from "../../src/db/schema.js";
import { code, setupServices } from "./helpers.js";

function setup() {
  const s = setupServices();
  const p1 = s.services.projects.create("you", { name: "P1" });
  const p2 = s.services.projects.create("you", { name: "P2" });
  let n = 0;
  // The issue service lives elsewhere; insert rows directly.
  const makeIssue = (projectId: string) => {
    n += 1;
    return s.db
      .insert(issues)
      .values({
        id: `issue-${n}`,
        projectId,
        key: "MAT",
        number: n,
        identifier: `MAT-${n}`,
        title: "t",
        createdBy: "you",
        createdAt: "2026-10-04T10:00:00.000Z",
        updatedAt: "2026-10-04T10:00:00.000Z",
      })
      .returning()
      .get();
  };
  const activityTypes = (issueId: string) =>
    s.db
      .select()
      .from(activity)
      .where(eq(activity.issueId, issueId))
      .all()
      .map((a) => `${a.type}:${JSON.parse(a.data).label}`);
  const attachedCount = (issueId: string) =>
    s.db
      .select()
      .from(issueLabels)
      .where(eq(issueLabels.issueId, issueId))
      .all().length;
  return { ...s, p1, p2, makeIssue, activityTypes, attachedCount };
}

describe("label CRUD", () => {
  it("creates with default colour, global or project scoped", () => {
    const { services, p1 } = setup();
    const g = services.labels.create({ name: "bug" });
    expect(g).toMatchObject({ color: "#6b7280", projectId: null });
    const l = services.labels.create({
      name: "bug",
      color: "#ff0000",
      project: p1.id,
    });
    expect(l).toMatchObject({ color: "#ff0000", projectId: p1.id });
  });

  it("rejects bad colours", () => {
    const { services } = setup();
    expect(
      code(() => services.labels.create({ name: "x", color: "red" })),
    ).toBe("validation_error");
  });

  it("rejects case-insensitive duplicates within a scope, allows across scopes", () => {
    const { services, p1, p2 } = setup();
    services.labels.create({ name: "Bug" });
    expect(code(() => services.labels.create({ name: "bUG" }))).toBe(
      "conflict",
    );
    // project scope coexists with global, and with other projects
    services.labels.create({ name: "bug", project: p1.id });
    services.labels.create({ name: "bug", project: p2.id });
    expect(
      code(() => services.labels.create({ name: "BUG", project: p1.id })),
    ).toBe("conflict");
  });

  it("rename conflicts, and a deleted label frees its name", () => {
    const { services } = setup();
    const a = services.labels.create({ name: "a" });
    const b = services.labels.create({ name: "b" });
    expect(code(() => services.labels.update(b.id, { name: "A" }))).toBe(
      "conflict",
    );
    // renaming only the case of itself is fine
    expect(services.labels.update(a.id, { name: "A" }).name).toBe("A");
    services.labels.delete(a.id);
    expect(services.labels.update(b.id, { name: "a" }).name).toBe("a");
    expect(code(() => services.labels.get(a.id))).toBe("not_found");
    expect(code(() => services.labels.update(b.id, {}))).toBe(
      "validation_error",
    );
  });

  it("lists global plus a project's labels, with includeDeleted", () => {
    const { services, p1, p2 } = setup();
    services.labels.create({ name: "g" });
    services.labels.create({ name: "p1", project: p1.id });
    services.labels.create({ name: "p2", project: p2.id });
    const gone = services.labels.create({ name: "old" });
    services.labels.delete(gone.id);
    const names = (x: { name: string }[]) => x.map((l) => l.name);
    expect(names(services.labels.list())).toEqual(["g"]);
    expect(names(services.labels.list({ project: "P1" }))).toEqual(["g", "p1"]);
    expect(
      names(services.labels.list({ project: p1.id, includeDeleted: true })),
    ).toEqual(["g", "old", "p1"]);
  });
});

describe("attach and detach", () => {
  it("attaches by name case-insensitively, idempotently, with activity only on change", () => {
    const { services, p1, makeIssue, activityTypes, attachedCount } = setup();
    services.labels.create({ name: "bug" });
    const issue = makeIssue(p1.id);
    expect(services.labels.attach("agent", issue.id, ["BUG"])).toHaveLength(1);
    expect(services.labels.attach("agent", issue.id, ["bug"])).toEqual([]);
    expect(attachedCount(issue.id)).toBe(1);
    expect(activityTypes(issue.id)).toEqual(["label_added:bug"]);

    expect(services.labels.detach("you", issue.id, ["bug"])).toHaveLength(1);
    expect(services.labels.detach("you", issue.id, ["bug"])).toEqual([]);
    expect(activityTypes(issue.id)).toEqual([
      "label_added:bug",
      "label_removed:bug",
    ]);
  });

  it("project label shadows a global one of the same name, others get the global", () => {
    const { services, p1, p2, makeIssue } = setup();
    const global = services.labels.create({ name: "bug" });
    const scoped = services.labels.create({
      name: "Bug",
      project: p1.id,
    });
    const i1 = makeIssue(p1.id);
    const i2 = makeIssue(p2.id);
    services.labels.attach("you", i1.id, ["bug"]);
    services.labels.attach("you", i2.id, ["bug"]);
    expect(services.labels.listForIssue(i1.id).map((l) => l.id)).toEqual([
      scoped.id,
    ]);
    expect(services.labels.listForIssue(i2.id).map((l) => l.id)).toEqual([
      global.id,
    ]);
  });

  it("falls back to global when the project has no such label; other projects' labels are unknown", () => {
    const { services, p1, p2, makeIssue } = setup();
    services.labels.create({ name: "g" });
    services.labels.create({ name: "only2", project: p2.id });
    const issue = makeIssue(p1.id);
    expect(services.labels.attach("you", issue.id, ["g"])).toHaveLength(1);
    expect(code(() => services.labels.attach("you", issue.id, ["only2"]))).toBe(
      "validation_error",
    );
  });

  it("unknown name lists existing labels and hint, and attaches nothing", () => {
    const { services, p1, p2, makeIssue, attachedCount, activityTypes } =
      setup();
    services.labels.create({ name: "bug" });
    services.labels.create({ name: "feature", project: p1.id });
    services.labels.create({ name: "hidden", project: p2.id });
    const issue = makeIssue(p1.id);
    let message = "";
    try {
      services.labels.attach("you", issue.id, ["bug", "bugg", "feature"]);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe(
      "Unknown label 'bugg'. Existing labels: bug, feature. Use save_issue_label to create one.",
    );
    expect(attachedCount(issue.id)).toBe(0);
    expect(activityTypes(issue.id)).toEqual([]);
    expect(code(() => services.labels.detach("you", issue.id, ["nope"]))).toBe(
      "validation_error",
    );
  });

  it("deleted labels are unknown and hidden from the issue", () => {
    const { services, p1, makeIssue } = setup();
    const l = services.labels.create({ name: "bug" });
    const issue = makeIssue(p1.id);
    services.labels.attach("you", issue.id, ["bug"]);
    services.labels.delete(l.id);
    expect(services.labels.listForIssue(issue.id)).toEqual([]);
    expect(code(() => services.labels.attach("you", issue.id, ["bug"]))).toBe(
      "validation_error",
    );
  });

  it("detaches by name a label that was soft-deleted while attached", () => {
    const { services, p1, makeIssue, attachedCount, activityTypes } = setup();
    const l = services.labels.create({ name: "bug" });
    const issue = makeIssue(p1.id);
    services.labels.attach("you", issue.id, ["bug"]);
    services.labels.delete(l.id);
    expect(services.labels.detach("you", issue.id, ["Bug"])).toHaveLength(1);
    expect(attachedCount(issue.id)).toBe(0);
    expect(activityTypes(issue.id)).toContain("label_removed:bug");
    // A name that never matched anything attached is still unknown.
    expect(code(() => services.labels.detach("you", issue.id, ["nope"]))).toBe(
      "validation_error",
    );
  });

  it("detach and setForIssue are all-or-nothing on unknown names", () => {
    const { services, p1, makeIssue, attachedCount } = setup();
    services.labels.create({ name: "a" });
    services.labels.create({ name: "b" });
    const issue = makeIssue(p1.id);
    services.labels.attach("you", issue.id, ["a"]);
    expect(
      code(() => services.labels.detach("you", issue.id, ["a", "zz"])),
    ).toBe("validation_error");
    expect(
      code(() => services.labels.setForIssue("you", issue.id, ["b", "zz"])),
    ).toBe("validation_error");
    expect(services.labels.listForIssue(issue.id).map((l) => l.name)).toEqual([
      "a",
    ]);
    expect(attachedCount(issue.id)).toBe(1);
  });

  it("rejects missing issues", () => {
    const { services } = setup();
    expect(code(() => services.labels.attach("you", "nope", []))).toBe(
      "not_found",
    );
  });

  it("setForIssue replaces the set, writing activity only for the difference", () => {
    const { services, p1, makeIssue, activityTypes } = setup();
    for (const name of ["a", "b", "c"]) {
      services.labels.create({ name });
    }
    const issue = makeIssue(p1.id);
    services.labels.setForIssue("you", issue.id, ["a", "b"]);
    const r = services.labels.setForIssue("you", issue.id, ["B", "c"]);
    expect(r.added.map((l) => l.name)).toEqual(["c"]);
    expect(r.removed.map((l) => l.name)).toEqual(["a"]);
    expect(services.labels.setForIssue("you", issue.id, ["b", "c"])).toEqual({
      added: [],
      removed: [],
    });
    expect(activityTypes(issue.id)).toEqual([
      "label_added:a",
      "label_added:b",
      "label_removed:a",
      "label_added:c",
    ]);
  });
});
