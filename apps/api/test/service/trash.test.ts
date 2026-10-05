import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("restoring a comment or attachment records its own activity type on the owning issue", async () => {
    const s = await setup();
    const i = s.issue();
    const c = s.services.comments.create("you", i.id, { body: "x" });
    const a = await s.attach(i.id);
    await s.del("comment", c.id);
    await s.del("attachment", a.id);
    s.services.trash.restore("you", "comment", c.id);
    s.services.trash.restore("you", "attachment", a.id);
    const types = s.acts(i.id).map((x) => x.type);
    expect(types.filter((t) => t === "comment_restored")).toHaveLength(1);
    expect(types.filter((t) => t === "attachment_restored")).toHaveLength(1);
    expect(types).not.toContain("issue_restored");
  });

  it("restoring a milestone re-links the issues that lost it", async () => {
    const s = await setup();
    const m = s.services.milestones.create("you", s.project.id, { name: "M" });
    const other = s.services.milestones.create("you", s.project.id, {
      name: "Other",
    });
    const a = s.issue("A", { milestoneId: m.id });
    const moved = s.issue("moved", { milestoneId: m.id });
    const gone = s.issue("gone", { milestoneId: m.id });
    await s.del("issue", gone.id);
    await s.del("milestone", m.id);
    // Moved to another milestone while the first was deleted: left alone.
    s.services.issues.update("you", moved.id, { milestoneId: other.id });
    s.services.trash.restore("you", "milestone", m.id);
    const ms = (id: string) =>
      s.db.select().from(issues).where(eq(issues.id, id)).get()?.milestoneId;
    expect(ms(a.id)).toBe(m.id);
    expect(ms(moved.id)).toBe(other.id);
    expect(ms(gone.id)).toBe(m.id);
    expect(
      s
        .acts(a.id)
        .filter(
          (x) =>
            x.type === "milestone_changed" &&
            JSON.parse(x.data).cause === "milestone_restored",
        ),
    ).toHaveLength(1);
    // A second delete/restore cycle relinks only what that delete cleared.
    s.services.issues.update("you", a.id, { milestoneId: null });
    await s.del("milestone", m.id);
    s.services.trash.restore("you", "milestone", m.id);
    expect(ms(a.id)).toBeNull();
  });
});

describe("change probe (TRC-90)", () => {
  // The dashboard polls `updatedAfter` + `includeDeleted`, newest updatedAt first.
  const probe = (s: Awaited<ReturnType<typeof setup>>, since: string) =>
    s.services.issues.list({
      updatedAfter: since,
      includeDeleted: true,
      orderBy: "updatedAt",
      order: "desc",
      limit: 1,
    }).items[0];

  it("delete and restore bump updatedAt of every hidden or revived row", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-05T10:00:00.000Z"));
      const s = await setup();
      const parent = s.issue("parent");
      const child = s.issue("child", { parentId: parent.id });
      const c = s.services.comments.create("you", parent.id, { body: "c" });
      const created = parent.updatedAt;

      vi.setSystemTime(new Date("2026-10-05T10:00:05.000Z"));
      await s.del("issue", parent.id);
      const rowOf = (id: string) =>
        s.db.select().from(issues).where(eq(issues.id, id)).get();
      expect(rowOf(parent.id)?.updatedAt).toBe("2026-10-05T10:00:05.000Z");
      expect(probe(s, created)?.updatedAt).toBe("2026-10-05T10:00:05.000Z");
      expect(rowOf(child.id)?.updatedAt).toBe("2026-10-05T10:00:05.000Z");
      expect(
        s.db.select().from(comments).where(eq(comments.id, c.id)).get()?.updatedAt,
      ).toBe("2026-10-05T10:00:05.000Z");

      vi.setSystemTime(new Date("2026-10-05T10:00:10.000Z"));
      s.services.trash.restore("you", "issue", parent.id);
      expect(s.services.issues.get(parent.id).updatedAt).toBe(
        "2026-10-05T10:00:10.000Z",
      );
      expect(probe(s, "2026-10-05T10:00:05.000Z")?.updatedAt).toBe(
        "2026-10-05T10:00:10.000Z",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("project and milestone delete/restore bump their updatedAt", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-05T10:00:00.000Z"));
      const s = await setup();
      const m = s.services.milestones.create("you", s.project.id, { name: "M" });
      vi.setSystemTime(new Date("2026-10-05T10:00:05.000Z"));
      await s.del("milestone", m.id);
      const at = (t: typeof milestones | typeof projects, id: string) =>
        (s.db.select().from(t as typeof milestones).where(eq(t.id, id)).get())?.updatedAt;
      expect(at(milestones, m.id)).toBe("2026-10-05T10:00:05.000Z");
      vi.setSystemTime(new Date("2026-10-05T10:00:06.000Z"));
      await s.del("project", s.project.id);
      expect(at(projects, s.project.id)).toBe("2026-10-05T10:00:06.000Z");
      vi.setSystemTime(new Date("2026-10-05T10:00:07.000Z"));
      s.services.trash.restore("you", "project", s.project.id);
      expect(at(projects, s.project.id)).toBe("2026-10-05T10:00:07.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a delete with a stale expectedUpdatedAt write still conflicts afterwards", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-05T10:00:00.000Z"));
      const s = await setup();
      const i = s.issue();
      vi.setSystemTime(new Date("2026-10-05T10:00:05.000Z"));
      await s.del("issue", i.id);
      s.services.trash.restore("you", "issue", i.id);
      expect(() =>
        s.services.issues.update("you", i.id, {
          title: "x",
          expectedUpdatedAt: i.updatedAt,
        }),
      ).toThrow(/modified since/);
    } finally {
      vi.useRealTimers();
    }
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
  afterEach(() => vi.useRealTimers());
  it("lists deleted items across types, newest first, paginated", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const s = await setup();
    const tick = () => vi.advanceTimersByTime(1000);
    const i = s.issue();
    const c = s.services.comments.create("you", i.id, { body: "hello" });
    const a = await s.attach(i.id);
    const m = s.services.milestones.create("you", s.project.id, { name: "M" });
    await s.del("attachment", a.id);
    tick();
    await s.del("comment", c.id);
    tick();
    await s.del("milestone", m.id);
    tick();
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

  it("says who deleted each item and which project it belongs to", async () => {
    const s = await setup();
    const m = s.services.milestones.create("you", s.project.id, { name: "M" });
    const parent = s.issue("parent");
    const child = s.issue("child", { parentId: parent.id });
    const c = s.services.comments.create("you", child.id, { body: "x" });
    const a = await s.attach(child.id);
    await s.services.trash.delete("agent", "milestone", m.id);
    await s.services.trash.delete("agent", "comment", c.id);
    await s.del("attachment", a.id);
    await s.del("issue", parent.id);
    const other = s.services.projects.create("you", { name: "Q" });
    await s.services.trash.delete("agent", "project", other.id);
    const byId = new Map(
      s.services.trash.list().items.map((x) => [x.id, x] as const),
    );
    const proj = { projectId: s.project.id, projectName: "P" };
    expect(byId.get(m.id)).toMatchObject({ deletedBy: "agent", ...proj });
    expect(byId.get(c.id)).toMatchObject({ deletedBy: "agent", ...proj });
    expect(byId.get(a.id)).toMatchObject({ deletedBy: "you", ...proj });
    expect(byId.get(parent.id)).toMatchObject({
      deletedBy: "you",
      parentId: null,
      ...proj,
    });
    expect(byId.get(child.id)).toMatchObject({
      deletedBy: "you",
      parentId: parent.id,
    });
    expect(byId.get(other.id)).toMatchObject({
      deletedBy: "agent",
      projectId: other.id,
      projectName: "Q",
    });
  });
});

describe("includeDeleted lists", () => {
  it("flag deleted rows with deleted: true and live rows with false", async () => {
    const s = await setup();
    const m = s.services.milestones.create("you", s.project.id, { name: "M" });
    const live = s.issue("live");
    const gone = s.issue("gone");
    const c = s.services.comments.create("you", live.id, { body: "x" });
    const reply = s.services.comments.create("you", live.id, {
      body: "r",
      parentId: c.id,
    });
    const keep = s.services.comments.create("you", live.id, { body: "k" });
    const label = s.services.labels.create({ name: "L" });
    await s.del("milestone", m.id);
    await s.del("issue", gone.id);
    await s.del("comment", c.id);
    s.services.labels.delete(label.id);

    const flags = (rows: { id: string; deleted?: boolean }[]) =>
      Object.fromEntries(rows.map((r) => [r.id, r.deleted]));
    expect(
      flags(
        s.services.issues.list({ project: s.project.id, includeDeleted: true })
          .items,
      ),
    ).toEqual({ [live.id]: false, [gone.id]: true });
    expect(
      flags(s.services.milestones.list(s.project.id, { includeDeleted: true })),
    ).toEqual({ [m.id]: true });
    expect(flags(s.services.labels.list({ includeDeleted: true }))).toEqual({
      [label.id]: true,
    });
    const threads = s.services.comments.list(live.id, { includeDeleted: true });
    expect(threads.map((t) => [t.id, t.deleted])).toEqual([
      [c.id, true],
      [keep.id, false],
    ]);
    expect(threads[0]?.replies.map((r) => r.deleted)).toEqual([true]);
    expect(reply.id).toBeTruthy();
    // Without the option the flag is absent.
    expect(
      s.services.issues.list({ project: s.project.id }).items[0],
    ).not.toHaveProperty("deleted");
    const plist = s.services.projects.list({ includeDeleted: true });
    expect(plist.every((p) => p.deleted === false)).toBe(true);
  });
});

describe("search index", () => {
  it("soft delete removes rows, restore brings them back, purge removes them", async () => {
    const s = await setup();
    const i = s.issue("alpha issue");
    const c = s.services.comments.create("you", i.id, { body: "beta comment" });
    const found = (q: string) => s.services.search.search({ q }).items.length;
    expect([found("alpha"), found("beta")]).toEqual([1, 1]);
    await s.del("comment", c.id);
    expect([found("alpha"), found("beta")]).toEqual([1, 0]);
    s.services.trash.restore("you", "comment", c.id);
    expect([found("alpha"), found("beta")]).toEqual([1, 1]);
    await s.del("issue", i.id);
    expect([found("alpha"), found("beta")]).toEqual([0, 0]);
    s.services.trash.restore("you", "issue", i.id);
    expect([found("alpha"), found("beta")]).toEqual([1, 1]);
    await s.del("issue", i.id);
    await s.services.trash.purge("you", "issue", i.id);
    expect([found("alpha"), found("beta")]).toEqual([0, 0]);
  });
});
