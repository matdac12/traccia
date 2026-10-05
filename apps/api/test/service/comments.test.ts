import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activity, comments } from "../../src/db/schema.js";
import { code, setupServices } from "./helpers.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

function setup() {
  const s = setupServices();
  const project = s.services.projects.create("you", { name: "P" });
  const issue = s.services.issues.create("agent", {
    project: project.id,
    title: "T",
  });
  const tick = (ms = 1000) => vi.advanceTimersByTime(ms);
  const softDelete = (id: string) =>
    s.db
      .update(comments)
      .set({ deletedAt: "2026-10-04T11:00:00.000Z" })
      .where(eq(comments.id, id))
      .run();
  const activityOf = (issueId: string) =>
    s.db
      .select()
      .from(activity)
      .all()
      .filter((a) => a.issueId === issueId);
  return { ...s, issue, tick, softDelete, activityOf, c: s.services.comments };
}

describe("create comment", () => {
  it("stamps the actor, resolves the identifier and writes comment_added", () => {
    const { c, issue, activityOf } = setup();
    const a = c.create("you", issue.identifier, { body: "hello" });
    expect(a).toMatchObject({
      issueId: issue.id,
      parentId: null,
      body: "hello",
      actor: "you",
      deletedAt: null,
    });
    expect(a.createdAt).toBe(a.updatedAt);
    const b = c.create("agent", issue.id, { body: "hi" });
    expect(b.actor).toBe("agent");
    expect(
      activityOf(issue.id)
        .filter((r) => r.type === "comment_added")
        .map((r) => [r.actor, JSON.parse(r.data).commentId]),
    ).toEqual([
      ["you", a.id],
      ["agent", b.id],
    ]);
  });

  it("rejects an empty body", () => {
    const { c, issue } = setup();
    expect(code(() => c.create("you", issue.id, { body: "  " }))).toBe(
      "validation_error",
    );
  });

  it("is not_found on a missing or deleted issue, with no activity written", () => {
    const { c, issue, services, sqlite, activityOf } = setup();
    expect(code(() => c.create("you", "MAT-999", { body: "x" }))).toBe(
      "not_found",
    );
    const other = services.issues.create("you", {
      project: issue.projectId,
      title: "gone",
    });
    sqlite
      .prepare("UPDATE issues SET deleted_at = ? WHERE id = ?")
      .run("2026-10-04T11:00:00.000Z", other.id);
    expect(code(() => c.create("you", other.id, { body: "x" }))).toBe(
      "not_found",
    );
    expect(activityOf(other.id).map((r) => r.type)).toEqual(["issue_created"]);
  });
});

describe("replies (one level)", () => {
  it("attaches a reply to a top-level comment", () => {
    const { c, issue, activityOf } = setup();
    const root = c.create("you", issue.id, { body: "root" });
    const reply = c.create("agent", issue.id, {
      body: "reply",
      parentId: root.id,
    });
    expect(reply.parentId).toBe(root.id);
    const added = activityOf(issue.id).filter(
      (r) => r.type === "comment_added",
    );
    expect(JSON.parse(added[1]?.data ?? "")).toMatchObject({
      parentId: root.id,
    });
  });

  it("rejects a reply to a reply (validation_error, nothing written)", () => {
    const { c, issue, db } = setup();
    const root = c.create("you", issue.id, { body: "root" });
    const reply = c.create("you", issue.id, { body: "r", parentId: root.id });
    expect(
      code(() =>
        c.create("you", issue.id, { body: "deep", parentId: reply.id }),
      ),
    ).toBe("validation_error");
    expect(db.select().from(comments).all()).toHaveLength(2);
  });

  it("is not_found for an unknown, deleted or other-issue parent", () => {
    const { c, issue, services, softDelete } = setup();
    const other = services.issues.create("you", {
      project: issue.projectId,
      title: "other",
    });
    const elsewhere = c.create("you", other.id, { body: "x" });
    const gone = c.create("you", issue.id, { body: "y" });
    softDelete(gone.id);
    for (const parentId of ["nope", elsewhere.id, gone.id]) {
      expect(
        code(() => c.create("you", issue.id, { body: "z", parentId })),
      ).toBe("not_found");
    }
  });
});

describe("update comment", () => {
  it("changes the body and bumps updated_at, keeping actor and created_at", () => {
    const { c, issue, tick } = setup();
    const a = c.create("agent", issue.id, { body: "v1" });
    tick();
    const b = c.update("you", a.id, { body: "v2" });
    expect(b).toMatchObject({
      body: "v2",
      actor: "agent",
      createdAt: a.createdAt,
    });
    expect(b.updatedAt).not.toBe(a.updatedAt);
  });

  it("is not_found for a missing or deleted comment and rejects an empty body", () => {
    const { c, issue, softDelete } = setup();
    const a = c.create("you", issue.id, { body: "v1" });
    expect(code(() => c.update("you", a.id, { body: "" }))).toBe(
      "validation_error",
    );
    softDelete(a.id);
    expect(code(() => c.update("you", a.id, { body: "x" }))).toBe("not_found");
    expect(code(() => c.update("you", "nope", { body: "x" }))).toBe(
      "not_found",
    );
  });
});

describe("list comments", () => {
  it("orders threads by created_at with replies grouped under their parent", () => {
    const { c, issue, tick } = setup();
    const a = c.create("you", issue.id, { body: "a" });
    tick();
    const b = c.create("you", issue.id, { body: "b" });
    tick();
    const a1 = c.create("agent", issue.id, { body: "a1", parentId: a.id });
    tick();
    const a2 = c.create("agent", issue.id, { body: "a2", parentId: a.id });
    const list = c.list(issue.id);
    expect(list.map((t) => t.id)).toEqual([a.id, b.id]);
    expect(list[0]?.replies.map((r) => r.id)).toEqual([a1.id, a2.id]);
    expect(list[1]?.replies).toEqual([]);
  });

  it("hides deleted comments (and replies of a deleted parent) unless includeDeleted", () => {
    const { c, issue, softDelete } = setup();
    const a = c.create("you", issue.id, { body: "a" });
    const r = c.create("you", issue.id, { body: "r", parentId: a.id });
    const b = c.create("you", issue.id, { body: "b" });
    const b1 = c.create("you", issue.id, { body: "b1", parentId: b.id });
    softDelete(a.id);
    softDelete(b1.id);
    const live = c.list(issue.id);
    expect(live.map((t) => t.id)).toEqual([b.id]);
    expect(live[0]?.replies).toEqual([]);
    const all = c.list(issue.id, { includeDeleted: true });
    expect(all.map((t) => t.id)).toEqual([a.id, b.id]);
    expect(all[0]?.replies.map((x) => x.id)).toEqual([r.id]);
    expect(all[1]?.replies.map((x) => x.id)).toEqual([b1.id]);
  });

  it("is not_found for a missing issue", () => {
    expect(code(() => setup().c.list("MAT-404"))).toBe("not_found");
  });
});

describe("get issue include=comments", () => {
  it("returns threads only when requested", () => {
    const { c, issue, services } = setup();
    const a = c.create("you", issue.id, { body: "a" });
    c.create("you", issue.id, { body: "r", parentId: a.id });
    expect(services.issues.get(issue.id).comments).toEqual([]);
    const got = services.issues.get(issue.id, ["comments"]);
    expect(got.comments).toHaveLength(1);
    expect(got.comments[0]).toMatchObject({ id: a.id });
    expect(got.comments[0]?.replies).toHaveLength(1);
  });
});
