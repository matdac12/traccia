import { type Actor, ServiceError } from "@traccia/shared";
import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { memories, projects } from "../db/schema.js";
import { newId } from "../ids.js";
import type { Page } from "../rest/pagination.js";
import { nowIso } from "../time.js";
import {
  type DbHandle,
  definedOnly,
  flagDeleted,
  parseInput,
  type ServiceContext,
} from "./context.js";
import { resolveProject } from "./projects.js";
import { indexMemory } from "./search-index.js";
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

/** Caps (ADR 0014 / TRC-127). The body is capped in bytes, the rest in characters. */
export const MEMORY_TITLE_MAX = 200;
export const MEMORY_BODY_MAX_BYTES = 64 * 1024;
export const MEMORY_TAGS_MAX = 20;
export const MEMORY_TAG_MAX = 50;

const titleSchema = z.string().trim().min(1).max(MEMORY_TITLE_MAX);
const bodySchema = z
  .string()
  .refine((b) => Buffer.byteLength(b, "utf8") <= MEMORY_BODY_MAX_BYTES, {
    message: `Must be at most ${MEMORY_BODY_MAX_BYTES} bytes`,
  });
/** Trimmed, non-empty, de-duplicated (case-sensitive), in first-seen order. */
const tagsSchema = z
  .array(z.string().trim().min(1).max(MEMORY_TAG_MAX))
  .max(MEMORY_TAGS_MAX)
  .transform((tags) => [...new Set(tags)]);

export const saveMemoryInputSchema = z.object({
  /** Present: update that memory. Absent: create one (needs `project` and `title`). */
  id: z.string().min(1).optional(),
  /** Project id, name or key. Required on create; on update it must match the memory's project. */
  project: z.string().min(1).optional(),
  title: titleSchema.optional(),
  body: bodySchema.optional(),
  tags: tagsSchema.optional(),
  expectedUpdatedAt: z.string().min(1).optional(),
});
export type SaveMemoryInput = z.input<typeof saveMemoryInputSchema>;

export const listMemoriesInputSchema = z.object({
  /** Substring of title or body (case-insensitive for ASCII). */
  query: z.string().trim().min(1).optional(),
  /** Every listed tag must be on the memory (AND). */
  tags: z.array(z.string().trim().min(1)).max(MEMORY_TAGS_MAX).optional(),
  includeDeleted: z.boolean().optional(),
  limit: z.number().int().min(1).optional(),
  cursor: z.string().min(1).optional(),
});
export type ListMemoriesInput = z.input<typeof listMemoriesInputSchema>;

/** A memory as clients see it: `tags` is a real array, not the stored JSON text. */
export type Memory = Omit<typeof memories.$inferSelect, "tags"> & {
  tags: string[];
};

export function toMemory(row: typeof memories.$inferSelect): Memory {
  return { ...row, tags: JSON.parse(row.tags) as string[] };
}

function findMemory(db: DbHandle, id: string): Memory {
  const row = db.select().from(memories).where(eq(memories.id, id)).get();
  // A memory of a soft-deleted project is treated as deleted too.
  const project = row
    ? db.select().from(projects).where(eq(projects.id, row.projectId)).get()
    : undefined;
  if (!row || row.deletedAt !== null || project?.deletedAt) {
    throw new ServiceError("not_found", `Memory "${id}" not found`);
  }
  return toMemory(row);
}

export function createMemoriesService(ctx: ServiceContext) {
  const trash = createTrashService(ctx);

  return {
    /**
     * Creates (no `id`) or updates (`id`) a memory; only given fields change on
     * update. A stale `expectedUpdatedAt` is a `conflict` and leaves the row
     * untouched. The FTS row is rewritten in the same transaction.
     */
    save(actor: Actor, input: SaveMemoryInput): Memory {
      const data = parseInput(saveMemoryInputSchema, input);
      return ctx.write((tx) => {
        const now = nowIso();
        if (!data.id) {
          if (!data.project || data.title === undefined) {
            throw new ServiceError(
              "validation_error",
              "project and title are required to create a memory",
            );
          }
          const project = resolveProject(tx, data.project);
          const row = tx
            .insert(memories)
            .values({
              id: newId(),
              projectId: project.id,
              title: data.title,
              body: data.body ?? "",
              tags: JSON.stringify(data.tags ?? []),
              createdBy: actor,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get();
          indexMemory(tx, row);
          return toMemory(row);
        }

        const memory = findMemory(tx, data.id);
        if (data.project) {
          const project = resolveProject(tx, data.project);
          if (project.id !== memory.projectId) {
            throw new ServiceError(
              "validation_error",
              "A memory cannot be moved to another project",
              { projectId: memory.projectId },
            );
          }
        }
        if (
          data.expectedUpdatedAt &&
          data.expectedUpdatedAt !== memory.updatedAt
        ) {
          throw new ServiceError(
            "conflict",
            "Memory was modified since it was read",
            { currentUpdatedAt: memory.updatedAt },
          );
        }
        const patch = definedOnly({
          title: data.title,
          body: data.body,
          tags: data.tags && JSON.stringify(data.tags),
        });
        if (Object.keys(patch).length === 0) {
          throw new ServiceError("validation_error", "No fields to update");
        }
        const row = tx
          .update(memories)
          .set({ ...patch, updatedAt: now })
          .where(eq(memories.id, memory.id))
          .returning()
          .get();
        indexMemory(tx, row);
        return toMemory(row);
      });
    },

    /** A live memory; deleted ones (and those of a deleted project) are `not_found`. */
    get(id: string): Memory {
      return findMemory(ctx.db, id);
    },

    /**
     * Memories of one project, most recently updated first (keyset-paginated).
     * Filters are AND-ed: `query` (title or body) and every given tag.
     */
    list(
      projectRef: string,
      input: ListMemoriesInput = {},
    ): Page<Memory & { deleted?: boolean }> {
      const q = parseInput(listMemoriesInputSchema, input);
      const project = resolveProject(ctx.db, projectRef);
      const limit = pageLimit(q.limit);
      const conditions: (SQL | undefined)[] = [
        eq(memories.projectId, project.id),
        q.includeDeleted ? undefined : isNull(memories.deletedAt),
      ];
      if (q.query)
        conditions.push(containsEither(memories.title, memories.body, q.query));
      for (const tag of new Set(q.tags ?? [])) {
        conditions.push(
          sql`EXISTS (SELECT 1 FROM json_each(${memories.tags}) WHERE value = ${tag})`,
        );
      }
      if (q.cursor) conditions.push(afterCursor(memories, q.cursor));
      const rows = ctx.db
        .select()
        .from(memories)
        .where(and(...conditions))
        .orderBy(...updatedAtOrder(memories))
        .limit(limit + 1)
        .all();
      const items = flagDeleted(
        rows.slice(0, limit).map(toMemory),
        q.includeDeleted,
      );
      const last = items[items.length - 1];
      return {
        items,
        nextCursor: rows.length > limit && last ? cursorOf(last) : null,
      };
    },

    /** Soft delete; the FTS row goes with it. See `trash.ts`. */
    delete(actor: Actor, id: string): DeleteResult {
      return trash.softDelete(actor, "memory", id);
    },

    restore(actor: Actor, id: string): RestoreResult {
      return trash.restore(actor, "memory", id);
    },

    /** Permanent delete of an already deleted memory; agents may (ADR 0015). */
    purge(actor: Actor, id: string): Promise<PurgeResult> {
      return trash.purge(actor, "memory", id);
    },
  };
}

export type MemoriesService = ReturnType<typeof createMemoriesService>;
