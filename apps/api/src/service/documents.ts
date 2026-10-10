import { Readable } from "node:stream";
import { type Actor, ServiceError } from "@traccia/shared";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { documents, projects } from "../db/schema.js";
import { newId } from "../ids.js";
import type { Page } from "../rest/pagination.js";
import {
  AttachmentValidationError,
  generateStorageKey,
  sanitizeFilename,
  storeUpload,
} from "../storage/index.js";
import { nowIso } from "../time.js";
import {
  type DbHandle,
  definedOnly,
  flagDeleted,
  parseInput,
  type ServiceContext,
} from "./context.js";
import { resolveProject } from "./projects.js";
import { indexDocument } from "./search-index.js";
import {
  createTrashService,
  type DeleteResult,
  type PurgeResult,
  type RestoreResult,
} from "./trash.js";
import {
  afterCursor,
  containsEither,
  cursorOf,
  pageLimit,
  updatedAtOrder,
} from "./updated-at-page.js";

/** Same cap as issue attachments (ADR 0014: "the 10 MiB cap"). */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_DESCRIPTION_MAX = 2000;

const descriptionSchema = z.string().max(DOCUMENT_DESCRIPTION_MAX);
const filenameSchema = z.string().trim().min(1);

export const updateDocumentInputSchema = z.object({
  filename: filenameSchema.optional(),
  description: descriptionSchema.optional(),
  expectedUpdatedAt: z.string().min(1).optional(),
});
export type UpdateDocumentInput = z.input<typeof updateDocumentInputSchema>;

export const listDocumentsInputSchema = z.object({
  /** Substring of filename or description (case-insensitive for ASCII). */
  query: z.string().trim().min(1).optional(),
  includeDeleted: z.boolean().optional(),
  limit: z.number().int().min(1).optional(),
  cursor: z.string().min(1).optional(),
});
export type ListDocumentsInput = z.input<typeof listDocumentsInputSchema>;

export type CreateDocumentInput = {
  filename: string;
  /** Declared type; must be on the allowlist and match the sniffed content. */
  mimeType: string;
  description?: string;
  /** The file bytes. Streams are validated while they are read. */
  content: Buffer | Readable;
};

/** A full row, including the opaque `storageKey` (for the download route). */
export type DocumentRecord = typeof documents.$inferSelect;
/** What clients see: the row without `storageKey`. */
export type Document = Omit<DocumentRecord, "storageKey">;

export function toDocument(row: DocumentRecord): Document {
  const { storageKey: _storageKey, ...rest } = row;
  return rest;
}

function findRecord(db: DbHandle, id: string): DocumentRecord {
  const row = db.select().from(documents).where(eq(documents.id, id)).get();
  // A document of a soft-deleted project is treated as deleted too.
  const project = row
    ? db.select().from(projects).where(eq(projects.id, row.projectId)).get()
    : undefined;
  if (!row || row.deletedAt !== null || project?.deletedAt) {
    throw new ServiceError("not_found", `Document "${id}" not found`);
  }
  return row;
}

export function createDocumentsService(ctx: ServiceContext) {
  const trash = createTrashService(ctx);

  return {
    /**
     * Validates and stores the bytes (allowlisted MIME type, content sniffing,
     * 10 MiB cap), then records the document. Content-addressed: if the project
     * already has a document (deleted or not) with the same sha256, the new row
     * shares that stored object and the fresh upload is dropped. Rejects before
     * reading any bytes when the project is unknown.
     */
    async create(
      actor: Actor,
      projectRef: string,
      input: CreateDocumentInput,
    ): Promise<Document> {
      const description = parseInput(
        descriptionSchema,
        input.description ?? "",
      );
      const filename = sanitizeFilename(
        parseInput(filenameSchema, input.filename),
      );
      const storage = ctx.storage;
      if (!storage) {
        throw new ServiceError("conflict", "File storage is not configured");
      }
      resolveProject(ctx.db, projectRef);

      const key = generateStorageKey();
      let upload: Awaited<ReturnType<typeof storeUpload>>;
      try {
        const source =
          input.content instanceof Readable
            ? input.content
            : Readable.from([input.content]);
        upload = await storeUpload(storage, key, source, {
          declaredMimeType: input.mimeType,
          maxBytes: DOCUMENT_MAX_BYTES,
        });
      } catch (err) {
        await storage.delete(key).catch(() => {});
        if (err instanceof AttachmentValidationError) {
          throw new ServiceError("validation_error", err.message, {
            reason: err.code,
          });
        }
        throw err;
      }

      let row: DocumentRecord;
      try {
        row = ctx.write((tx) => {
          const project = resolveProject(tx, projectRef);
          const twin = tx
            .select({ storageKey: documents.storageKey })
            .from(documents)
            .where(
              and(
                eq(documents.projectId, project.id),
                eq(documents.sha256, upload.sha256),
              ),
            )
            .get();
          const now = nowIso();
          const created = tx
            .insert(documents)
            .values({
              id: newId(),
              projectId: project.id,
              filename,
              mimeType: upload.mimeType,
              sizeBytes: upload.sizeBytes,
              storageKey: twin?.storageKey ?? key,
              sha256: upload.sha256,
              description,
              createdBy: actor,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get();
          indexDocument(tx, created);
          return created;
        });
      } catch (err) {
        await storage.delete(key).catch(() => {});
        throw err;
      }
      if (row.storageKey !== key) await storage.delete(key).catch(() => {});
      return toDocument(row);
    },

    /** Metadata of a live document; deleted ones are `not_found`. */
    get(id: string): Document {
      return toDocument(findRecord(ctx.db, id));
    },

    /** Like `get`, but with the `storageKey` the download route needs. */
    getRecord(id: string): DocumentRecord {
      return findRecord(ctx.db, id);
    },

    /** Renames and/or re-describes a document (bytes never change). */
    update(id: string, input: UpdateDocumentInput): Document {
      const { expectedUpdatedAt, ...raw } = parseInput(
        updateDocumentInputSchema,
        input,
      );
      const patch = definedOnly({
        filename: raw.filename && sanitizeFilename(raw.filename),
        description: raw.description,
      });
      if (Object.keys(patch).length === 0) {
        throw new ServiceError("validation_error", "No fields to update");
      }
      return ctx.write((tx) => {
        const doc = findRecord(tx, id);
        if (expectedUpdatedAt && expectedUpdatedAt !== doc.updatedAt) {
          throw new ServiceError(
            "conflict",
            "Document was modified since it was read",
            { currentUpdatedAt: doc.updatedAt },
          );
        }
        const row = tx
          .update(documents)
          .set({ ...patch, updatedAt: nowIso() })
          .where(eq(documents.id, doc.id))
          .returning()
          .get();
        indexDocument(tx, row);
        return toDocument(row);
      });
    },

    /** Documents of one project, most recently updated first (keyset-paginated). */
    list(
      projectRef: string,
      input: ListDocumentsInput = {},
    ): Page<Document & { deleted?: boolean }> {
      const q = parseInput(listDocumentsInputSchema, input);
      const project = resolveProject(ctx.db, projectRef);
      const limit = pageLimit(q.limit);
      const conditions: (SQL | undefined)[] = [
        eq(documents.projectId, project.id),
        q.includeDeleted ? undefined : isNull(documents.deletedAt),
      ];
      if (q.query)
        conditions.push(
          containsEither(documents.filename, documents.description, q.query),
        );
      if (q.cursor) conditions.push(afterCursor(documents, q.cursor));
      const rows = ctx.db
        .select()
        .from(documents)
        .where(and(...conditions))
        .orderBy(...updatedAtOrder(documents))
        .limit(limit + 1)
        .all();
      const items = flagDeleted(
        rows.slice(0, limit).map(toDocument),
        q.includeDeleted,
      );
      const last = items[items.length - 1];
      return {
        items,
        nextCursor: rows.length > limit && last ? cursorOf(last) : null,
      };
    },

    /** Soft delete; the file stays until purge. */
    delete(actor: Actor, id: string): DeleteResult {
      return trash.softDelete(actor, "document", id);
    },

    restore(actor: Actor, id: string): RestoreResult {
      return trash.restore(actor, "document", id);
    },

    /** Permanent delete of an already deleted document; agents may (ADR 0015). */
    purge(actor: Actor, id: string): Promise<PurgeResult> {
      return trash.purge(actor, "document", id);
    },
  };
}

export type DocumentsService = ReturnType<typeof createDocumentsService>;
