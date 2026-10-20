import { z } from "zod";
import { limitText } from "./rest-issue-schemas.js";
import {
  listLabelsQuerySchema,
  listMilestonesQuerySchema,
  listProjectsQuerySchema,
  queryBooleanSchema,
} from "./rest-catalog-schemas.js";

// REST request schemas (query and body) that the API validates with and the
// dashboard's API client is typed against (TRC-137): a request the API would
// reject is a compile error in `apps/web/lib/api`, not a runtime 400.

/** `?limit=&cursor=` on every paginated list. The API additionally decodes and clamps them. */
export const pageQuerySchema = z.object({
  limit: limitText.optional(),
  cursor: z.string().min(1).optional(),
});

/** `GET /v1/projects`: the filters plus the page. */
export const listProjectsRequestQuerySchema = listProjectsQuerySchema.extend(
  pageQuerySchema.shape,
);

/** `GET /v1/projects/:idOrKey/milestones`. */
export const listMilestonesRequestQuerySchema =
  listMilestonesQuerySchema.extend(pageQuerySchema.shape);

/** `GET /v1/labels`. */
export const listLabelsRequestQuerySchema = listLabelsQuerySchema.extend(
  pageQuerySchema.shape,
);

/** `GET /v1/projects/:idOrKey/memories`. */
export const listMemoriesQuerySchema = z.object({
  /** Full-text search. Never empty: omit it for the unfiltered list, `?query=` is a 400 (TRC-136). */
  query: z.string().min(1).optional(),
  /** Repeated `?tags=a&tags=b` (AND) or one comma-separated value. */
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined
        ? undefined
        : (Array.isArray(v) ? v : [v])
            .flatMap((t) => t.split(","))
            .map((t) => t.trim())
            .filter(Boolean),
    ),
  includeDeleted: queryBooleanSchema.optional(),
  ...pageQuerySchema.shape,
});

/** `POST /v1/projects/:idOrKey/memories` and `PATCH /v1/memories/:id`. */
export const memoryBodySchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
  expectedUpdatedAt: z.string().min(1).optional(),
});
export type MemoryBody = z.input<typeof memoryBodySchema>;

/** `GET /v1/projects/:idOrKey/documents`. */
export const listDocumentsQuerySchema = z.object({
  /** Never empty, like the memories search. */
  query: z.string().min(1).optional(),
  includeDeleted: queryBooleanSchema.optional(),
  ...pageQuerySchema.shape,
});

/** `PATCH /v1/documents/:id` (uploads are multipart and not covered here). */
export const updateDocumentBodySchema = z.object({
  filename: z.string().optional(),
  description: z.string().optional(),
  expectedUpdatedAt: z.string().min(1).optional(),
});
export type UpdateDocumentBody = z.input<typeof updateDocumentBodySchema>;

/**
 * A query string as the API reads it: a repeated key becomes an array, a single
 * one stays a string. The API validates exactly this shape, so tests and the
 * dashboard client can check a URL against a query schema the same way.
 */
export function searchParamsRecord(
  params: URLSearchParams,
): Record<string, string | string[]> {
  // No prototype: `?__proto__=x` is an ordinary key, not the object's prototype.
  const raw: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of params.entries()) {
    const existing = raw[key];
    if (existing === undefined) raw[key] = value;
    else
      raw[key] = [...(Array.isArray(existing) ? existing : [existing]), value];
  }
  return raw;
}
