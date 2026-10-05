import { type Actor, ServiceError } from "@traccia/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { attachments, comments } from "../db/schema.js";
import { newId } from "../ids.js";
import { nowIso } from "../time.js";
import type { DbHandle, ServiceContext } from "./context.js";
import { type Issue, recordActivity, resolveIssue } from "./issues.js";

/** A full row, including the opaque `storageKey`; never sent to clients. */
export type AttachmentRecord = typeof attachments.$inferSelect;
/** What clients see: the row without `storageKey`. */
export type Attachment = Omit<AttachmentRecord, "storageKey">;

export type CreateAttachmentInput = {
  commentId?: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
};

export function toAttachment(row: AttachmentRecord): Attachment {
  const { storageKey: _storageKey, ...rest } = row;
  return rest;
}

/** Live attachments of an issue, oldest first. */
export function listIssueAttachments(
  db: DbHandle,
  issueId: string,
): Attachment[] {
  return db
    .select()
    .from(attachments)
    .where(and(eq(attachments.issueId, issueId), isNull(attachments.deletedAt)))
    .orderBy(asc(attachments.createdAt), asc(attachments.id))
    .all()
    .map(toAttachment);
}

/**
 * A comment an attachment may hang off must be live and on the same issue.
 * Anything else is `validation_error`, so a file never lands on the wrong issue.
 */
function assertCommentOnIssue(
  db: DbHandle,
  issueId: string,
  commentId: string,
): void {
  const comment = db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
    .get();
  if (!comment || comment.issueId !== issueId) {
    throw new ServiceError(
      "validation_error",
      `Comment "${commentId}" does not belong to this issue`,
      { commentId },
    );
  }
}

function findRecord(db: DbHandle, id: string): AttachmentRecord | undefined {
  return db.select().from(attachments).where(eq(attachments.id, id)).get();
}

const notFound = (id: string) =>
  new ServiceError("not_found", `Attachment "${id}" not found`);

export function createAttachmentsService(ctx: ServiceContext) {
  return {
    /** Resolves the issue an upload targets, so an unknown one is rejected before any bytes are read. */
    resolveTarget(issueRef: string): Issue {
      return resolveIssue(ctx.db, issueRef);
    },

    /** Records an already stored file. Writes an `attachment_added` activity row. */
    create(
      actor: Actor,
      issueRef: string,
      input: CreateAttachmentInput,
    ): Attachment {
      return ctx.write((tx) => {
        const issue = resolveIssue(tx, issueRef);
        if (input.commentId)
          assertCommentOnIssue(tx, issue.id, input.commentId);
        const now = nowIso();
        const row = tx
          .insert(attachments)
          .values({
            id: newId(),
            issueId: issue.id,
            commentId: input.commentId ?? null,
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            sha256: input.sha256,
            storageKey: input.storageKey,
            actor,
            createdAt: now,
          })
          .returning()
          .get();
        recordActivity(
          tx,
          issue.id,
          actor,
          "attachment_added",
          {
            attachmentId: row.id,
            commentId: row.commentId,
            filename: row.filename,
          },
          now,
        );
        return toAttachment(row);
      });
    },

    /** Metadata of a live attachment; deleted ones are `not_found`. */
    get(id: string): Attachment {
      return toAttachment(this.getRecord(id));
    },

    /** Like `get`, but with the `storageKey` the download route needs. */
    getRecord(id: string): AttachmentRecord {
      const row = findRecord(ctx.db, id);
      if (!row || row.deletedAt !== null) throw notFound(id);
      return row;
    },

    list(issueRef: string): Attachment[] {
      return listIssueAttachments(ctx.db, resolveIssue(ctx.db, issueRef).id);
    },

    // Delete and purge live in trash.ts (`trash.delete` / `trash.purge`).
  };
}

export type AttachmentsService = ReturnType<typeof createAttachmentsService>;
