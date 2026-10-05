import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  activity,
  attachments,
  comments,
  issues,
  milestones,
  projects,
} from "../../src/db/schema.js";
import { newId } from "../../src/ids.js";
import { createServices } from "../../src/service/index.js";
import { LocalDiskStorage } from "../../src/storage/index.js";
import { createTestDb } from "../helpers/test-db.js";
import { onCleanup } from "./helpers.js";

async function setup(opts: { allowAgentPurge?: boolean } = {}) {
  const { sqlite, db } = createTestDb();
  onCleanup(() => sqlite.close());
  const dir = await mkdtemp(path.join(tmpdir(), "trash-"));
  onCleanup(() => void rm(dir, { recursive: true, force: true }));
  const storage = new LocalDiskStorage(dir);
  const services = createServices({
    db,
    defaultIssueKey: "MAT",
    storage,
    ...opts,
  });
  const project = services.projects.create("you", { name: "P" });
  const issue = (title = "T", extra: Record<string, unknown> = {}) =>
    services.issues.create("agent", { project: project.id, title, ...extra });
  const attach = async (issueId: string, commentId: string | null = null) => {
    const id = newId();
    const key = `k/${id}`;
    await storage.put(key, Buffer.from("x"), { mimeType: "text/plain" });
    db.insert(attachments)
      .values({
        id,
        issueId,
        commentId,
        filename: "f.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        sha256: "0",
        storageKey: key,
        actor: "you",
        createdAt: "2026-10-05T00:00:00.000Z",
      })
      .run();
    return { id, file: path.join(dir, key) };
  };
  const index = (refId: string, issueId = refId) =>
    db.run(
      sql`INSERT INTO search_index(kind, ref_id, issue_id, title, body) VALUES ('issue', ${refId}, ${issueId}, 't', 'b')`,
    );
  const indexed = (refId: string) =>
    db.all(sql`SELECT 1 FROM search_index WHERE ref_id = ${refId}`).length > 0;
  const acts = (issueId: string) =>
    db.select().from(activity).where(eq(activity.issueId, issueId)).all();
  const del = (type: Parameters<typeof services.trash.delete>[1], id: string) =>
    services.trash.delete("you", type, id);
  return { db, services, project, issue, attach, index, indexed, acts, del };
}

const batchOf = (r: unknown) => (r as { batch: string }).batch;

describe("soft delete cascades", () => {
  it("project hides milestones, issues, comments, attachments in one batch", async () => {
    const s = await setup();
    const m = s.services.milestones.create("you", s.project.id, { name: "M" });
    const i = s.issue();
    const c = s.services.comments.create("you", i.id, { body: "hi" });
    const a = await s.attach(i.id);
    const r = await s.del("project", s.project.id);
    const b = batchOf(r);
    expect(r).toMatchObject({
      counts: {
        projects: 1,
        milestones: 1,
        issues: 1,
        comments: 1,
        attachments: 1,
      },
    });
    const batchOfRow = (
      t:
        | typeof projects
        | typeof milestones
        | typeof issues
        | typeof comments
        | typeof attachments,
      id: string,
    ) =>
      s.db
        .select()
        .from(t as typeof projects)
        .where(eq(t.id, id))
        .get()?.deletedBatch;
    for (const [t, id] of [
      [projects, s.project.id],
      [milestones, m.id],
      [issues, i.id],
      [comments, c.id],
      [attachments, a.id],
    ] as const) {
      expect(batchOfRow(t, id)).toBe(b);
    }
    expect(s.services.projects.list()).toEqual([]);
    expect(s.acts(i.id).map((x) => x.type)).toContain("issue_deleted");
  });

  it("milestone hides only itself and clears milestone_id on issues", async () => {
    const s = await setup();
    const m = s.services.milestones.create("you", s.project.id, { name: "M" });
    const i = s.issue("T", { milestoneId: m.id });
    await s.del("milestone", m.id);
    const row = s.db.select().from(issues).where(eq(issues.id, i.id)).get();
    expect(row).toMatchObject({ milestoneId: null, deletedAt: null });
    const rec = s
      .acts(i.id)
      .find(
        (x) => x.type === "milestone_changed" && JSON.parse(x.data).to === null,
      );
    expect(rec).toBeTruthy();
    expect(s.services.milestones.list(s.project.id)).toEqual([]);
  });

  it("issue hides sub-issues, comments and attachments", async () => {
    const s = await setup();
    const p = s.issue("parent");
    const ch = s.issue("child", { parentId: p.id });
    const other = s.issue("other");
    const c = s.services.comments.create("you", ch.id, { body: "x" });
    const a = await s.attach(p.id);
    const r = await s.del("issue", p.id);
    expect(r).toMatchObject({
      counts: { issues: 2, comments: 1, attachments: 1 },
    });
    const get = (
      t: typeof issues | typeof comments | typeof attachments,
      id: string,
    ) =>
      s.db
        .select()
        .from(t as typeof issues)
        .where(eq(t.id, id))
        .get()?.deletedAt;
    expect(get(issues, ch.id)).not.toBeNull();
    expect(get(comments, c.id)).not.toBeNull();
    expect(get(attachments, a.id)).not.toBeNull();
    expect(get(issues, other.id)).toBeNull();
  });

  it("comment hides replies and their attachments; attachment hides itself", async () => {
    const s = await setup();
    const i = s.issue();
    const c = s.services.comments.create("you", i.id, { body: "top" });
    const rep = s.services.comments.create("you", i.id, {
      body: "re",
      parentId: c.id,
    });
    const a = await s.attach(i.id, rep.id);
    const keep = await s.attach(i.id);
    const r = await s.del("comment", c.id);
    expect(r).toMatchObject({ counts: { comments: 2, attachments: 1 } });
    expect(
      s.db.select().from(attachments).where(eq(attachments.id, keep.id)).get()
        ?.deletedAt,
    ).toBeNull();
    const types = s.acts(i.id).map((x) => x.type);
    expect(types.filter((t) => t === "comment_deleted")).toHaveLength(2);
    expect(types).toContain("attachment_deleted");
    await s.del("attachment", keep.id);
    expect(
      s.db.select().from(attachments).where(eq(attachments.id, keep.id)).get()
        ?.deletedAt,
    ).not.toBeNull();
    void a;
  });

  it("deleting an already deleted or unknown item is not_found", async () => {
    const s = await setup();
    const i = s.issue();
    await s.del("issue", i.id);
    await expect(s.del("issue", i.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(s.del("comment", "nope")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("restore", () => {
  it("brings back exactly its batch, not earlier-deleted items", async () => {
    const s = await setup();
    const i = s.issue();
    const early = s.services.comments.create("you", i.id, { body: "early" });
    const late = s.services.comments.create("you", i.id, { body: "late" });
    await s.del("comment", early.id);
    await s.del("issue", i.id);
    const r = s.services.trash.restore("you", "issue", i.id);
    expect(r.counts).toMatchObject({ issues: 1, comments: 1 });
    const live = (id: string) =>
      s.db.select().from(comments).where(eq(comments.id, id)).get()?.deletedAt;
    expect(live(late.id)).toBeNull();
    expect(live(early.id)).not.toBeNull();
    expect(s.acts(i.id).map((x) => x.type)).toContain("issue_restored");
  });

  it("restoring any member restores the whole project batch", async () => {
    const s = await setup();
    const i = s.issue();
    const r = await s.del("project", s.project.id);
    s.services.trash.restore("you", "project", s.project.id);
    expect(s.services.issues.get(i.id).id).toBe(i.id);
    expect(() => s.services.trash.restore("you", "issue", i.id)).toThrow(
      /not deleted/,
    );
    void r;
  });

  it("refuses to restore under a deleted parent", async () => {
    const s = await setup();
    const i = s.issue();
    const c = s.services.comments.create("you", i.id, { body: "x" });
    await s.del("comment", c.id);
    await s.del("issue", i.id);
    expect(() => s.services.trash.restore("you", "comment", c.id)).toThrow(
      /issue is deleted/,
    );
  });

  it("restoring a comment records activity on the owning issue", async () => {
    const s = await setup();
    const i = s.issue();
    const c = s.services.comments.create("you", i.id, { body: "x" });
    await s.del("comment", c.id);
    s.services.trash.restore("you", "comment", c.id);
    expect(
      s.acts(i.id).filter((x) => x.type === "issue_restored"),
    ).toHaveLength(1);
  });
});

describe("purge", () => {
  it("requires a prior soft delete", async () => {
    const s = await setup();
    const i = s.issue();
    await expect(
      s.services.trash.purge("you", "issue", i.id),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      s.services.trash.delete("you", "issue", i.id, { purge: true }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("denies agents by default, allows with the flag", async () => {
    const s = await setup();
    const i = s.issue();
    await s.services.trash.delete("agent", "issue", i.id);
    await expect(
      s.services.trash.purge("agent", "issue", i.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    const s2 = await setup({ allowAgentPurge: true });
    const j = s2.issue();
    await s2.del("issue", j.id);
    await expect(
      s2.services.trash.purge("agent", "issue", j.id),
    ).resolves.toMatchObject({ type: "issue" });
  });

  it("removes rows, search rows and files; numbers are never reused", async () => {
    const s = await setup();
    const first = s.issue("first");
    const last = s.issue("last");
    const c = s.services.comments.create("you", last.id, { body: "x" });
    const a = await s.attach(last.id);
    s.index(last.id);
    s.index(c.id, last.id);
    await s.del("issue", last.id);
    expect(existsSync(a.file)).toBe(true);
    const r = await s.services.trash.delete("you", "issue", last.id, {
      purge: true,
    });
    expect(r).toMatchObject({
      counts: { issues: 1, comments: 1, attachments: 1 },
      failedFiles: [],
    });
    expect(existsSync(a.file)).toBe(false);
    expect(s.indexed(last.id)).toBe(false);
    expect(s.indexed(c.id)).toBe(false);
    expect(
      s.db.select().from(issues).where(eq(issues.id, last.id)).get(),
    ).toBeUndefined();
    expect(
      s.db.select().from(activity).where(eq(activity.issueId, last.id)).all(),
    ).toEqual([]);
    const next = s.issue("next");
    expect(next.number).toBeGreaterThan(last.number);
    void first;
  });

  it("purges a whole deleted project including blockers and scoped labels", async () => {
    const s = await setup();
    const a = s.issue("a");
    const b = s.issue("b");
    s.services.relations.addBlocker("you", a.id, b.id);
    s.services.labels.create({ name: "L", project: s.project.id });
    await s.del("project", s.project.id);
    await s.services.trash.purge("you", "project", s.project.id);
    expect(s.db.select().from(projects).all()).toEqual([]);
    expect(s.db.select().from(issues).all()).toEqual([]);
  });
});

describe("trash listing", () => {
  it("lists deleted items across types, newest first, paginated", async () => {
    const s = await setup();
    const i = s.issue();
    const c = s.services.comments.create("you", i.id, { body: "hello" });
    const a = await s.attach(i.id);
    const m = s.services.milestones.create("you", s.project.id, { name: "M" });
    await s.del("attachment", a.id);
    await s.del("comment", c.id);
    await s.del("milestone", m.id);
    const j = s.issue("gone");
    await s.del("issue", j.id);
    const all = s.services.trash.list();
    expect(all.items.map((x) => x.type)).toEqual([
      "issue",
      "milestone",
      "comment",
      "attachment",
    ]);
    expect(all.items.every((x) => x.deleted && x.deletedBatch)).toBe(true);
    const p1 = s.services.trash.list({ limit: 3 });
    expect(p1.items).toHaveLength(3);
    const p2 = s.services.trash.list({ limit: 3, cursor: p1.nextCursor ?? "" });
    expect(p2.items.map((x) => x.id)).toEqual([all.items[3]?.id]);
    expect(p2.nextCursor).toBeNull();
    expect(s.services.trash.list({ type: "comment" }).items).toHaveLength(1);
  });
});
