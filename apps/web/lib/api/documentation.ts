import "server-only";
import { z } from "zod";
import { api } from "./client";
import { deletedResultSchema, documentSchema, memorySchema, pageOf } from "./schemas";

const PAGE_SIZE = 100;
/** A project's documentation is small by design; this bounds the walk over its pages. */
const MAX_PAGES = 10;

async function listAll<S extends z.ZodType>(path: string, schema: S, query: Record<string, string | readonly string[] | undefined>): Promise<z.output<S>[]> {
  const items: z.output<S>[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await api().request(path, { schema: pageOf(schema), query: { ...query, limit: PAGE_SIZE, cursor } });
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

export type MemoryInput = { title?: string; body?: string; tags?: string[] };

export const listMemories = (projectId: string, opts: { query?: string; tag?: string } = {}) =>
  listAll(`/projects/${encodeURIComponent(projectId)}/memories`, memorySchema, { query: opts.query, tags: opts.tag });

/** Every tag in use in the project, for the filter row (memories are small, so the list is walked unfiltered). */
export const tagsOf = (memories: readonly { tags: readonly string[] }[]) => [...new Set(memories.flatMap((m) => m.tags))].sort((a, b) => a.localeCompare(b));

export const createMemory = (projectId: string, body: MemoryInput) =>
  api().request(`/projects/${encodeURIComponent(projectId)}/memories`, { schema: memorySchema, method: "POST", body });

export const updateMemory = (id: string, body: MemoryInput & { expectedUpdatedAt: string }) =>
  api().request(`/memories/${encodeURIComponent(id)}`, { schema: memorySchema, method: "PATCH", body });

/** Soft delete (restorable). */
export const deleteMemory = (id: string) => api().request(`/memories/${encodeURIComponent(id)}`, { schema: deletedResultSchema, method: "DELETE" });

export const listDocuments = (projectId: string, opts: { query?: string } = {}) =>
  listAll(`/projects/${encodeURIComponent(projectId)}/documents`, documentSchema, { query: opts.query });

export const updateDocument = (id: string, body: { filename?: string; description?: string; expectedUpdatedAt: string }) =>
  api().request(`/documents/${encodeURIComponent(id)}`, { schema: documentSchema, method: "PATCH", body });

/** Soft delete (restorable). */
export const deleteDocument = (id: string) => api().request(`/documents/${encodeURIComponent(id)}`, { schema: deletedResultSchema, method: "DELETE" });

/** Undo of a delete. `restoreItem` in `trash.ts` only knows the Trash page's types, so memories and documents restore here. */
export const restoreDocumentation = (type: "memory" | "document", id: string) =>
  api().request("/restore", { schema: z.unknown(), method: "POST", body: { type, id } });
