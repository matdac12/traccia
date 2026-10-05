import {
  type Actor,
  type CreateCommentInput,
  createCommentInputSchema,
  type ListCommentsInput,
  ServiceError,
  type UpdateCommentInput,
  updateCommentInputSchema,
} from "@linear-matti/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { comments } from "../db/schema.js";
import { newId } from "../ids.js";
import { nowIso } from "../time.js";
import { type DbHandle, parseInput, type ServiceContext } from "./context.js";
import { recordActivity, resolveIssue } from "./issues.js";

export type Comment = typeof comments.$inferSelect;
/** A top-level comment with its replies (oldest first). Replies never have replies. */
export type CommentThread = Comment & { replies: Comment[] };

/**
 * Threading is one level deep. Replying to a reply is REJECTED with
 * `validation_error` (not flattened to the root), so a caller never has a
 * comment silently attached somewhere other than where it asked.
 */
function assertReplyable(
  db: DbHandle,
  parentRef: string,
  issueId: string,
): Comment {
  const parent = db
    .select()
    .from(comments)
    .where(and(eq(comments.id, parentRef), isNull(comments.deletedAt)))
    .get();
  if (!parent || parent.issueId !== issueId) {
    throw new ServiceError("not_found", `Comment "${parentRef}" not found`);
  }
  if (parent.parentId !== null) {
    throw new ServiceError(
      "validation_error",
      "Cannot reply to a reply; reply to the top-level comment instead",
      { parentId: parent.id, rootId: parent.parentId },
    );
  }
  return parent;
}

/**
 * Comments of an issue as threads, ordered by `created_at` (id breaks ties).
 * Deleted comments are hidden unless `includeDeleted`; replies of a hidden
 * parent are hidden with it.
 */
export function listIssueComments(
  db: DbHandle,
  issueId: string,
  includeDeleted = false,
): CommentThread[] {
  const rows = db
    .select()
    .from(comments)
    .where(
      includeDeleted
        ? eq(comments.issueId, issueId)
        : and(eq(comments.issueId, issueId), isNull(comments.deletedAt)),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .all();
  const threads = new Map<string, CommentThread>();
  for (const c of rows) {
    if (c.parentId === null) threads.set(c.id, { ...c, replies: [] });
  }
  for (const c of rows) {
    if (c.parentId !== null) threads.get(c.parentId)?.replies.push(c);
  }
  return [...threads.values()];
}

export function createCommentsService(ctx: ServiceContext) {
  return {
    /** `issueRef` is an identifier or ULID; a missing or deleted issue is `not_found`. */
    create(actor: Actor, issueRef: string, input: CreateCommentInput): Comment {
      const data = parseInput(createCommentInputSchema, input);
      return ctx.write((tx) => {
        const issue = resolveIssue(tx, issueRef);
        const parent = data.parentId
          ? assertReplyable(tx, data.parentId, issue.id)
          : null;
        const now = nowIso();
        const comment = tx
          .insert(comments)
          .values({
            id: newId(),
            issueId: issue.id,
            parentId: parent?.id ?? null,
            body: data.body,
            actor,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        recordActivity(
          tx,
          issue.id,
          actor,
          "comment_added",
          { commentId: comment.id, parentId: comment.parentId },
          now,
        );
        return comment;
      });
    },

    /** Replaces the body and bumps `updated_at`. Deleted comments are `not_found`. */
    update(
      _actor: Actor,
      commentId: string,
      input: UpdateCommentInput,
    ): Comment {
      const data = parseInput(updateCommentInputSchema, input);
      return ctx.write((tx) => {
        const existing = tx
          .select()
          .from(comments)
          .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
          .get();
        if (!existing) {
          throw new ServiceError(
            "not_found",
            `Comment "${commentId}" not found`,
          );
        }
        if (existing.body === data.body) return existing;
        return tx
          .update(comments)
          .set({ body: data.body, updatedAt: nowIso() })
          .where(eq(comments.id, commentId))
          .returning()
          .get();
      });
    },

    list(issueRef: string, input: ListCommentsInput = {}): CommentThread[] {
      const issue = resolveIssue(ctx.db, issueRef);
      return listIssueComments(ctx.db, issue.id, input.includeDeleted);
    },
  };
}

export type CommentsService = ReturnType<typeof createCommentsService>;
