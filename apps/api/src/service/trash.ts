import { type Actor, ServiceError } from "@linear-matti/shared";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { canPurge } from "../auth/permissions.js";
import {
  activity,
  attachments,
  comments,
  issueLabels,
  issueRelations,
  issues,
  labels,
  milestones,
  projects,
} from "../db/schema.js";
import { newId } from "../ids.js";
import { decodeCursor, encodeCursor } from "../rest/pagination.js";
import { StorageNotFoundError } from "../storage/storage.js";
import { nowIso } from "../time.js";
import { parseInput, type ServiceContext, type Tx } from "./context.js";
import { loadSubtree } from "./hierarchy.js";
import { recordActivity } from "./issues.js";
import { resolveProject } from "./projects.js";
import { reindexIssues, removeFromSearchIndex } from "./search-index.js";

/**
 * Soft delete, restore, purge and the Trash listing (ADR 0004).
 *
 * Batch mechanism (reuse this from other services)
 * ------------------------------------------------
 * A delete stamps `deleted_at` + one shared `deleted_batch` ULID on the
 * target and every live dependent, in ONE transaction. Rows that were already
 * deleted keep their earlier batch, so restore brings back exactly what that
 * action deleted. Cascade rules:
 *
 *   project    -> its milestones, issues, and their comments + attachments
 *   milestone  -> itself only; its issues stay live and get `milestone_id`
 *                 cleared (one `milestone_changed` activity row each)
 *   issue      -> its sub-issue subtree, comments + attachments
 *   comment    -> its replies and the attachments tied to them
 *   attachment -> itself
 *
 * Restoring a milestone re-links the issues that lost it (found through their
 * `milestone_deleted` activity rows), unless an issue was given another
 * milestone, or moved to another project, in the meantime. Purge also drops the
 * activity of purged issues and project-scoped labels, as foreign keys require.
 *
 * Other services never stamp `deleted_at` themselves. To delete an
 * attachment (MAT-1703) call `trash.delete(actor, "attachment", id)` from
 * the transport, or `softDeleteAttachment(tx, actor, id)` to join a larger
 * transaction. Files stay on disk until the row is purged.
 *
 * Purge is a separate second step: only on already-deleted items, only if
 * `canPurge(actor)`. It removes rows, activity of purged issues, search rows
 * and (after commit, via the storage interface) attachment files. The issue
 * key counter is untouched, so issue numbers are never reused.
 */

export const TRASH_TYPES = [
  "project",
  "milestone",
  "issue",
  "comment",
  "attachment",
] as const;
export type TrashType = (typeof TRASH_TYPES)[number];

export type DeleteResult = {
  type: TrashType;
  id: string;
  /** Shared by everything this delete hid; pass any member to `restore`. */
  batch: string;
  counts: Counts;
  /** Human identifier (`MAT-3`); issues only. */
  identifier?: string;
  /** Issue title, project/milestone name, comment snippet or attachment filename. */
  title: string;
};
export type RestoreResult = Omit<DeleteResult, "id"> & { id: string };
export type PurgeResult = {
  type: TrashType;
  id: string;
  counts: Counts;
  /** Storage keys that could not be removed (rows are already gone). */
  failedFiles: string[];
};

type Counts = {
  projects: number;
  milestones: number;
  issues: number;
  comments: number;
  attachments: number;
};
const emptyCounts = (): Counts => ({
  projects: 0,
  milestones: 0,
  issues: 0,
  comments: 0,
  attachments: 0,
});

export type TrashItem = {
  type: TrashType;
  id: string;
  /** Project/milestone name, issue identifier + title, comment excerpt or filename. */
  label: string;
  deletedAt: string;
  deletedBatch: string | null;
  /** Owning issue for comments and attachments. */
  issueId: string | null;
  /** Parent issue, for sub-issues. */
  parentId: string | null;
  /** Project the item belongs to (a project is its own); null only for legacy rows. */
  projectId: string | null;
  projectName: string | null;
  /** Actor that deleted it; null for rows deleted before this was recorded. */
  deletedBy: Actor | null;
  deleted: true;
};

export const listTrashInputSchema = z.object({
  type: z.enum(TRASH_TYPES).optional(),
  limit: z.number().int().min(1).max(250).optional(),
  cursor: z.string().min(1).optional(),
});
export type ListTrashInput = z.infer<typeof listTrashInputSchema>;

const notFound = (type: TrashType, ref: string) =>
  new ServiceError("not_found", `${type} "${ref}" not found`);

type Sets = {
  projectIds: string[];
  milestoneIds: string[];
  issueIds: string[];
  commentIds: string[];
  attachmentIds: string[];
};

const countsOf = (s: Sets): Counts => ({
  projects: s.projectIds.length,
  milestones: s.milestoneIds.length,
  issues: s.issueIds.length,
  comments: s.commentIds.length,
  attachments: s.attachmentIds.length,
});

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

/** Comments + attachments hanging off `issueIds`, filtered by `liveOnly`. */
function loadIssueDependents(tx: Tx, issueIds: string[], liveOnly: boolean) {
  if (issueIds.length === 0) return { commentIds: [], attachmentIds: [] };
  const commentRows = tx
    .select({ id: comments.id })
    .from(comments)
    .where(
      and(
        inArray(comments.issueId, issueIds),
        liveOnly ? isNull(comments.deletedAt) : undefined,
      ),
    )
    .all();
  const attachmentRows = tx
    .select({ id: attachments.id })
    .from(attachments)
    .where(
      and(
        inArray(attachments.issueId, issueIds),
        liveOnly ? isNull(attachments.deletedAt) : undefined,
      ),
    )
    .all();
  return { commentIds: ids(commentRows), attachmentIds: ids(attachmentRows) };
}

/** Comment + its replies, and the attachments tied to any of them. */
function loadCommentThread(tx: Tx, commentId: string, liveOnly: boolean) {
  const live = (col: AnySQLiteColumn) => (liveOnly ? isNull(col) : undefined);
  const rows = tx
    .select({ id: comments.id })
    .from(comments)
    .where(
      and(
        or(eq(comments.id, commentId), eq(comments.parentId, commentId)),
        live(comments.deletedAt),
      ),
    )
    .all();
  const commentIds = ids(rows);
  const attachmentRows = tx
    .select({ id: attachments.id })
    .from(attachments)
    .where(
      and(
        inArray(attachments.commentId, commentIds),
        live(attachments.deletedAt),
      ),
    )
    .all();
  return { commentIds, attachmentIds: ids(attachmentRows) };
}

/**
 * Everything `type`/`id` takes with it. `liveOnly` (soft delete) skips rows
 * that are already deleted so they keep their earlier batch; purge takes all
 * of them because foreign keys require it.
 */
function collect(tx: Tx, type: TrashType, id: string, liveOnly: boolean): Sets {
  const empty: Sets = {
    projectIds: [],
    milestoneIds: [],
    issueIds: [],
    commentIds: [],
    attachmentIds: [],
  };
  const live = (col: AnySQLiteColumn) => (liveOnly ? isNull(col) : undefined);
  switch (type) {
    case "project": {
      const issueIds = ids(
        tx
          .select({ id: issues.id })
          .from(issues)
          .where(and(eq(issues.projectId, id), live(issues.deletedAt)))
          .all(),
      );
      return {
        ...empty,
        projectIds: [id],
        milestoneIds: ids(
          tx
            .select({ id: milestones.id })
            .from(milestones)
            .where(
              and(eq(milestones.projectId, id), live(milestones.deletedAt)),
            )
            .all(),
        ),
        issueIds,
        ...loadIssueDependents(tx, issueIds, liveOnly),
      };
    }
    case "milestone":
      return { ...empty, milestoneIds: [id] };
    case "issue": {
      const root = tx.select().from(issues).where(eq(issues.id, id)).get();
      if (!root) return empty;
      const issueIds = loadSubtree(tx, root)
        .rows.filter((r) => !liveOnly || r.deletedAt === null)
        .map((r) => r.id);
      return {
        ...empty,
        issueIds,
        ...loadIssueDependents(tx, issueIds, liveOnly),
      };
    }
    case "comment":
      return { ...empty, ...loadCommentThread(tx, id, liveOnly) };
    case "attachment":
      return { ...empty, attachmentIds: [id] };
  }
}

function stamp(
  tx: Tx,
  s: Sets,
  batch: string,
  now: string,
  actor: Actor,
): void {
  const mark = { deletedAt: now, deletedBatch: batch, deletedBy: actor };
  if (s.projectIds.length)
    tx.update(projects)
      .set(mark)
      .where(inArray(projects.id, s.projectIds))
      .run();
  if (s.milestoneIds.length)
    tx.update(milestones)
      .set(mark)
      .where(inArray(milestones.id, s.milestoneIds))
      .run();
  if (s.issueIds.length)
    tx.update(issues).set(mark).where(inArray(issues.id, s.issueIds)).run();
  if (s.commentIds.length)
    tx.update(comments)
      .set(mark)
      .where(inArray(comments.id, s.commentIds))
      .run();
  if (s.attachmentIds.length)
    tx.update(attachments)
      .set(mark)
      .where(inArray(attachments.id, s.attachmentIds))
      .run();
}

/** Loads a row of `type` by id, deleted or not. Issues also accept an identifier. */
function load(tx: Tx, type: TrashType, ref: string) {
  switch (type) {
    case "project":
      try {
        return resolveProject(tx, ref, { includeDeleted: true });
      } catch (e) {
        if (e instanceof ServiceError && e.code === "not_found")
          return undefined;
        throw e;
      }
    case "milestone":
      return tx.select().from(milestones).where(eq(milestones.id, ref)).get();
    case "issue":
      return tx
        .select()
        .from(issues)
        .where(or(eq(issues.id, ref), eq(issues.identifier, ref.toUpperCase())))
        .get();
    case "comment":
      return tx.select().from(comments).where(eq(comments.id, ref)).get();
    case "attachment":
      return tx.select().from(attachments).where(eq(attachments.id, ref)).get();
  }
}

/** Soft-deletes one attachment inside `tx`; for callers composing a larger transaction. */
export function softDeleteAttachment(
  tx: Tx,
  actor: Actor,
  attachmentId: string,
): DeleteResult {
  return softDelete(tx, actor, "attachment", attachmentId);
}

/** Human-facing name of a loaded row, so callers can confirm what they acted on. */
function describeRow(
  type: TrashType,
  row: Record<string, unknown>,
): { identifier?: string; title: string } {
  switch (type) {
    case "issue":
      return {
        identifier: String(row.identifier),
        title: String(row.title),
      };
    case "comment":
      return { title: String(row.body).slice(0, 80) };
    case "attachment":
      return { title: String(row.filename) };
    default:
      return { title: String(row.name) };
  }
}

function softDelete(
  tx: Tx,
  actor: Actor,
  type: TrashType,
  ref: string,
): DeleteResult {
  const row = load(tx, type, ref);
  if (!row || row.deletedAt) throw notFound(type, ref);
  const id = row.id;
  const batch = newId();
  const now = nowIso();
  const sets = collect(tx, type, id, true);
  stamp(tx, sets, batch, now, actor);

  if (type === "milestone") {
    // Issues keep living: only their milestone link goes (deleted ones too, so
    // a later restore of such an issue never points at a deleted milestone).
    const linked = tx
      .select()
      .from(issues)
      .where(eq(issues.milestoneId, id))
      .all();
    for (const issue of linked) {
      tx.update(issues)
        .set({
          milestoneId: null,
          ...(issue.deletedAt ? {} : { updatedAt: now }),
        })
        .where(eq(issues.id, issue.id))
        .run();
      recordActivity(
        tx,
        issue.id,
        actor,
        "milestone_changed",
        { from: id, to: null, cause: "milestone_deleted", batch },
        now,
      );
    }
  }

  // Activity rows (issues carry the timeline). A project/issue delete writes
  // one `issue_deleted` per hidden issue; comment/attachment deletes write
  // their own type on the owning issue.
  const base = { batch, via: type, viaId: id };
  const commentRows = sets.commentIds.length
    ? tx
        .select()
        .from(comments)
        .where(inArray(comments.id, sets.commentIds))
        .all()
    : [];
  for (const issueId of sets.issueIds) {
    recordActivity(tx, issueId, actor, "issue_deleted", base, now);
  }
  if (type === "comment" || type === "attachment") {
    for (const c of commentRows) {
      recordActivity(
        tx,
        c.issueId,
        actor,
        "comment_deleted",
        { ...base, commentId: c.id },
        now,
      );
    }
    const attRows = sets.attachmentIds.length
      ? tx
          .select()
          .from(attachments)
          .where(inArray(attachments.id, sets.attachmentIds))
          .all()
      : [];
    for (const a of attRows) {
      recordActivity(
        tx,
        a.issueId,
        actor,
        "attachment_deleted",
        { ...base, attachmentId: a.id },
        now,
      );
    }
  }

  removeFromSearchIndex(tx, {
    refIds: sets.commentIds,
    issueIds: sets.issueIds,
  });
  return {
    type,
    id,
    batch,
    counts: countsOf(sets),
    ...describeRow(type, row),
  };
}

function restoreBatch(
  tx: Tx,
  actor: Actor,
  type: TrashType,
  ref: string,
): RestoreResult {
  const row = load(tx, type, ref);
  if (!row) throw notFound(type, ref);
  if (!row.deletedAt) {
    throw new ServiceError("conflict", `${type} "${ref}" is not deleted`);
  }
  assertRestorable(tx, type, row);
  const batch = row.deletedBatch;

  const byBatch = <T extends { deletedBatch: unknown; id: unknown }>(
    t: T,
    selfId: string,
  ) => (batch ? eq(t.deletedBatch as never, batch) : eq(t.id as never, selfId));
  const sets: Sets = {
    projectIds: ids(
      tx
        .select({ id: projects.id })
        .from(projects)
        .where(byBatch(projects, row.id))
        .all(),
    ),
    milestoneIds: ids(
      tx
        .select({ id: milestones.id })
        .from(milestones)
        .where(byBatch(milestones, row.id))
        .all(),
    ),
    issueIds: ids(
      tx
        .select({ id: issues.id })
        .from(issues)
        .where(byBatch(issues, row.id))
        .all(),
    ),
    commentIds: ids(
      tx
        .select({ id: comments.id })
        .from(comments)
        .where(byBatch(comments, row.id))
        .all(),
    ),
    attachmentIds: ids(
      tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(byBatch(attachments, row.id))
        .all(),
    ),
  };
  const clear = { deletedAt: null, deletedBatch: null, deletedBy: null };
  if (sets.projectIds.length)
    tx.update(projects)
      .set(clear)
      .where(inArray(projects.id, sets.projectIds))
      .run();
  if (sets.milestoneIds.length)
    tx.update(milestones)
      .set(clear)
      .where(inArray(milestones.id, sets.milestoneIds))
      .run();
  if (sets.issueIds.length)
    tx.update(issues).set(clear).where(inArray(issues.id, sets.issueIds)).run();
  if (sets.commentIds.length)
    tx.update(comments)
      .set(clear)
      .where(inArray(comments.id, sets.commentIds))
      .run();
  if (sets.attachmentIds.length)
    tx.update(attachments)
      .set(clear)
      .where(inArray(attachments.id, sets.attachmentIds))
      .run();

  // A restored issue gets `issue_restored`; a restored comment/attachment
  // records its own type on the owning issue with the ids in `data` (the issue
  // itself was never hidden).
  const now = nowIso();
  const base = { batch, via: type, viaId: row.id };
  for (const issueId of sets.issueIds) {
    recordActivity(tx, issueId, actor, "issue_restored", base, now);
  }
  if (type === "comment" || type === "attachment") {
    const owner = (row as { issueId: string }).issueId;
    recordActivity(
      tx,
      owner,
      actor,
      type === "comment" ? "comment_restored" : "attachment_restored",
      {
        ...base,
        commentIds: sets.commentIds,
        attachmentIds: sets.attachmentIds,
      },
      now,
    );
  }
  if (type === "milestone") relinkIssues(tx, actor, row.id, now);
  // Re-adds each affected issue and its live comments (a restored comment
  // re-indexes its owning issue, which is a no-op for the rest).
  const commentOwners = sets.commentIds.length
    ? tx
        .select({ issueId: comments.issueId })
        .from(comments)
        .where(inArray(comments.id, sets.commentIds))
        .all()
        .map((c) => c.issueId)
    : [];
  reindexIssues(tx, [...new Set([...sets.issueIds, ...commentOwners])]);
  return {
    type,
    id: row.id,
    batch: batch ?? "",
    counts: countsOf(sets),
    ...describeRow(type, row),
  };
}

/**
 * Gives a restored milestone back to the issues that lost it when it was
 * deleted. An issue qualifies when its latest `milestone_changed` activity is
 * that deletion and it still has no milestone (deleted issues included, they
 * were cleared too).
 */
function relinkIssues(
  tx: Tx,
  actor: Actor,
  milestoneId: string,
  now: string,
): void {
  const milestone = tx
    .select()
    .from(milestones)
    .where(eq(milestones.id, milestoneId))
    .get();
  if (!milestone) return;
  const candidates = tx
    .select({ issueId: activity.issueId })
    .from(activity)
    .innerJoin(issues, eq(issues.id, activity.issueId))
    .where(
      and(
        eq(activity.type, "milestone_changed"),
        sql`json_extract(${activity.data}, '$.cause') = 'milestone_deleted'`,
        sql`json_extract(${activity.data}, '$.from') = ${milestoneId}`,
        isNull(issues.milestoneId),
        eq(issues.projectId, milestone.projectId),
      ),
    )
    .all();
  for (const issueId of new Set(candidates.map((c) => c.issueId))) {
    const latest = tx
      .select()
      .from(activity)
      .where(
        and(
          eq(activity.issueId, issueId),
          eq(activity.type, "milestone_changed"),
        ),
      )
      .orderBy(desc(activity.createdAt), desc(activity.id))
      .get();
    if (!latest) continue;
    const d = JSON.parse(latest.data) as { cause?: string; from?: string };
    if (d.cause !== "milestone_deleted" || d.from !== milestoneId) continue;
    const issue = tx.select().from(issues).where(eq(issues.id, issueId)).get();
    tx.update(issues)
      .set({
        milestoneId,
        ...(issue?.deletedAt ? {} : { updatedAt: now }),
      })
      .where(eq(issues.id, issueId))
      .run();
    recordActivity(
      tx,
      issueId,
      actor,
      "milestone_changed",
      { from: null, to: milestoneId, cause: "milestone_restored" },
      now,
    );
  }
}

/** A batch member cannot come back while what it hangs off is still deleted. */
function assertRestorable(
  tx: Tx,
  type: TrashType,
  row: NonNullable<ReturnType<typeof load>>,
): void {
  const blocked = (what: string, id: string) =>
    new ServiceError(
      "conflict",
      `Cannot restore ${type}: its ${what} is deleted. Restore the ${what} first.`,
      { [what]: id },
    );
  const isDeleted = (
    t: typeof projects | typeof issues | typeof comments,
    id: string,
  ) => {
    const r = tx
      .select({ d: t.deletedAt })
      .from(t as typeof projects)
      .where(eq(t.id, id))
      .get();
    return !r || r.d !== null;
  };
  if (type === "milestone") {
    const m = row as typeof milestones.$inferSelect;
    if (isDeleted(projects, m.projectId)) throw blocked("project", m.projectId);
  } else if (type === "issue") {
    const i = row as typeof issues.$inferSelect;
    if (isDeleted(projects, i.projectId)) throw blocked("project", i.projectId);
    if (i.parentId && isDeleted(issues, i.parentId))
      throw blocked("parent issue", i.parentId);
  } else if (type === "comment") {
    const c = row as typeof comments.$inferSelect;
    if (isDeleted(issues, c.issueId)) throw blocked("issue", c.issueId);
    if (c.parentId && isDeleted(comments, c.parentId))
      throw blocked("parent comment", c.parentId);
  } else if (type === "attachment") {
    const a = row as typeof attachments.$inferSelect;
    if (isDeleted(issues, a.issueId)) throw blocked("issue", a.issueId);
    if (a.commentId && isDeleted(comments, a.commentId))
      throw blocked("comment", a.commentId);
  }
}

/** Deletes rows for a purge; returns the storage keys to remove after commit. */
function purgeRows(
  tx: Tx,
  type: TrashType,
  id: string,
): { sets: Sets; keys: string[] } {
  const sets = collect(tx, type, id, false);
  const attRows = sets.attachmentIds.length
    ? tx
        .select()
        .from(attachments)
        .where(inArray(attachments.id, sets.attachmentIds))
        .all()
    : [];

  if (sets.attachmentIds.length)
    tx.delete(attachments)
      .where(inArray(attachments.id, sets.attachmentIds))
      .run();
  if (sets.commentIds.length)
    tx.delete(comments).where(inArray(comments.id, sets.commentIds)).run();
  if (sets.issueIds.length) {
    tx.delete(issueLabels)
      .where(inArray(issueLabels.issueId, sets.issueIds))
      .run();
    tx.delete(issueRelations)
      .where(
        or(
          inArray(issueRelations.blockerId, sets.issueIds),
          inArray(issueRelations.blockedId, sets.issueIds),
        ),
      )
      .run();
    tx.delete(activity).where(inArray(activity.issueId, sets.issueIds)).run();
    tx.delete(issues).where(inArray(issues.id, sets.issueIds)).run();
  }
  if (type === "milestone") {
    tx.update(issues)
      .set({ milestoneId: null })
      .where(eq(issues.milestoneId, id))
      .run();
  }
  if (sets.milestoneIds.length)
    tx.delete(milestones)
      .where(inArray(milestones.id, sets.milestoneIds))
      .run();
  if (type === "project") {
    const scoped = ids(
      tx
        .select({ id: labels.id })
        .from(labels)
        .where(eq(labels.projectId, id))
        .all(),
    );
    if (scoped.length) {
      tx.delete(issueLabels).where(inArray(issueLabels.labelId, scoped)).run();
      tx.delete(labels).where(inArray(labels.id, scoped)).run();
    }
    tx.delete(projects).where(eq(projects.id, id)).run();
  }
  removeFromSearchIndex(tx, {
    refIds: sets.commentIds,
    issueIds: sets.issueIds,
  });
  return { sets, keys: attRows.map((a) => a.storageKey) };
}

export function createTrashService(ctx: ServiceContext) {
  async function purge(
    actor: Actor,
    type: TrashType,
    ref: string,
  ): Promise<PurgeResult> {
    if (!canPurge(actor, { allowAgentPurge: ctx.allowAgentPurge })) {
      throw new ServiceError("forbidden", "This actor is not allowed to purge");
    }
    const { id, sets, keys } = ctx.write((tx) => {
      const row = load(tx, type, ref);
      if (!row) throw notFound(type, ref);
      if (!row.deletedAt) {
        throw new ServiceError(
          "conflict",
          `${type} "${ref}" must be deleted before it can be purged`,
        );
      }
      if (!ctx.storage && type !== "milestone") {
        const pending = collect(tx, type, row.id, false).attachmentIds;
        if (pending.length) {
          throw new ServiceError(
            "conflict",
            "Attachment storage is not configured",
          );
        }
      }
      return { id: row.id, ...purgeRows(tx, type, row.id) };
    });
    const failedFiles: string[] = [];
    for (const key of keys) {
      try {
        await ctx.storage?.delete(key);
      } catch (e) {
        if (!(e instanceof StorageNotFoundError)) failedFiles.push(key);
      }
    }
    return { type, id, counts: countsOf(sets), failedFiles };
  }

  return {
    /**
     * Soft-deletes `type`/`ref` and its dependents under one new batch. With
     * `purge: true` it instead permanently removes an ALREADY deleted item
     * (`conflict` otherwise; `forbidden` unless `canPurge(actor)`). Async
     * because purge removes attachment files after the DB commit.
     */
    async delete(
      actor: Actor,
      type: TrashType,
      ref: string,
      options: { purge?: boolean } = {},
    ): Promise<DeleteResult | PurgeResult> {
      if (options.purge) return purge(actor, type, ref);
      return ctx.write((tx) => softDelete(tx, actor, type, ref));
    },

    /** Restores the whole batch `type`/`ref` was deleted in. */
    restore(actor: Actor, type: TrashType, ref: string): RestoreResult {
      return ctx.write((tx) => restoreBatch(tx, actor, type, ref));
    },

    purge,

    /** Deleted items of all types, newest deletion first (keyset-paginated). */
    list(input: ListTrashInput = {}): {
      items: TrashItem[];
      nextCursor: string | null;
    } {
      const q = parseInput(listTrashInputSchema, input);
      const limit = q.limit ?? 50;
      let after: { d: string; i: string } | undefined;
      if (q.cursor) {
        const c = decodeCursor(q.cursor) as { d?: unknown; i?: unknown };
        if (typeof c.d !== "string" || typeof c.i !== "string") {
          throw new ServiceError("validation_error", "Invalid cursor");
        }
        after = { d: c.d, i: c.i };
      }
      const rows = ctx.db.all<{
        type: TrashType;
        id: string;
        label: string;
        deleted_at: string;
        batch: string | null;
        issue_id: string | null;
        parent_id: string | null;
        project_id: string | null;
        project_name: string | null;
        deleted_by: Actor | null;
      }>(sql`
        SELECT t.*, p.name AS project_name FROM (
          SELECT 'project' AS type, id, name AS label, deleted_at, deleted_batch AS batch, NULL AS issue_id,
                 NULL AS parent_id, id AS project_id, deleted_by
            FROM projects WHERE deleted_at IS NOT NULL
          UNION ALL
          SELECT 'milestone', id, name, deleted_at, deleted_batch, NULL, NULL, project_id, deleted_by
            FROM milestones WHERE deleted_at IS NOT NULL
          UNION ALL
          SELECT 'issue', id, identifier || ' ' || title, deleted_at, deleted_batch, NULL, parent_id, project_id, deleted_by
            FROM issues WHERE deleted_at IS NOT NULL
          UNION ALL
          SELECT 'comment', c.id, substr(c.body, 1, 80), c.deleted_at, c.deleted_batch, c.issue_id, NULL,
                 (SELECT project_id FROM issues WHERE id = c.issue_id), c.deleted_by
            FROM comments c WHERE c.deleted_at IS NOT NULL
          UNION ALL
          SELECT 'attachment', a.id, a.filename, a.deleted_at, a.deleted_batch, a.issue_id, NULL,
                 (SELECT project_id FROM issues WHERE id = a.issue_id), a.deleted_by
            FROM attachments a WHERE a.deleted_at IS NOT NULL
        ) t LEFT JOIN projects p ON p.id = t.project_id
        WHERE ${q.type ? sql`t.type = ${q.type}` : sql`1`}
          AND ${after ? sql`(t.deleted_at < ${after.d} OR (t.deleted_at = ${after.d} AND t.id < ${after.i}))` : sql`1`}
        ORDER BY t.deleted_at DESC, t.id DESC
        LIMIT ${limit + 1}
      `);
      const items: TrashItem[] = rows.slice(0, limit).map((r) => ({
        type: r.type,
        id: r.id,
        label: r.label,
        deletedAt: r.deleted_at,
        deletedBatch: r.batch,
        issueId: r.issue_id,
        parentId: r.parent_id,
        projectId: r.project_id,
        projectName: r.project_name,
        deletedBy: r.deleted_by,
        deleted: true,
      }));
      const last = items[items.length - 1];
      return {
        items,
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({ d: last.deletedAt, i: last.id })
            : null,
      };
    },
  };
}

export type TrashService = ReturnType<typeof createTrashService>;
