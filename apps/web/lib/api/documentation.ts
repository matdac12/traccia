import "server-only";
import { listDocumentsQuerySchema, listMemoriesQuerySchema, memoryBodySchema, type MemoryBody, restoreBodySchema, updateDocumentBodySchema, type UpdateDocumentBody } from "@traccia/shared";
import { z } from "zod";
import { api } from "./client";
import { listAll as listAllPages } from "./list-all";
import { deletedResultSchema, documentSchema, memorySchema } from "./schemas";

const PAGE_SIZE = 100;
/** A project's documentation is small by design; this bounds the walk over its pages. */
const MAX_PAGES = 10;

/** Drop empty filters: the API's `query` is `.min(1)`, so an absent search must be omitted, not sent as `?query=`. */
const definedFilters = (query: object) =>
  Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)));

const listAll = <S extends z.ZodType, QS extends z.ZodType>(path: string, schema: S, querySchema: QS, query: Parameters<typeof listAllPages<S, QS>>[3]) =>
  listAllPages(path, schema, querySchema, definedFilters(query) as typeof query, { pageSize: PAGE_SIZE, maxPages: MAX_PAGES });

export const listMemories = (projectId: string, opts: { query?: string; tag?: string } = {}) =>
  listAll(`/projects/${encodeURIComponent(projectId)}/memories`, memorySchema, listMemoriesQuerySchema, { query: opts.query, tags: opts.tag });

/** Every tag in use in the project, for the filter row (memories are small, so the list is walked unfiltered). */
export const tagsOf = (memories: readonly { tags: readonly string[] }[]) => [...new Set(memories.flatMap((m) => m.tags))].sort((a, b) => a.localeCompare(b));

export const createMemory = (projectId: string, body: MemoryBody) =>
  api().request(`/projects/${encodeURIComponent(projectId)}/memories`, { schema: memorySchema, method: "POST", bodySchema: memoryBodySchema, body });

export const updateMemory = (id: string, body: MemoryBody & { expectedUpdatedAt: string }) =>
  api().request(`/memories/${encodeURIComponent(id)}`, { schema: memorySchema, method: "PATCH", bodySchema: memoryBodySchema, body });

/** Soft delete (restorable). */
export const deleteMemory = (id: string) => api().request(`/memories/${encodeURIComponent(id)}`, { schema: deletedResultSchema, method: "DELETE" });

export const listDocuments = (projectId: string, opts: { query?: string } = {}) =>
  listAll(`/projects/${encodeURIComponent(projectId)}/documents`, documentSchema, listDocumentsQuerySchema, { query: opts.query });

export const updateDocument = (id: string, body: UpdateDocumentBody & { expectedUpdatedAt: string }) =>
  api().request(`/documents/${encodeURIComponent(id)}`, { schema: documentSchema, method: "PATCH", bodySchema: updateDocumentBodySchema, body });

/** Soft delete (restorable). */
export const deleteDocument = (id: string) => api().request(`/documents/${encodeURIComponent(id)}`, { schema: deletedResultSchema, method: "DELETE" });

/** Undo of a delete. `restoreItem` in `trash.ts` only knows the Trash page's types, so memories and documents restore here. */
export const restoreDocumentation = (type: "memory" | "document", id: string) =>
  api().request("/restore", { schema: z.unknown(), method: "POST", bodySchema: restoreBodySchema, body: { type, id } });
