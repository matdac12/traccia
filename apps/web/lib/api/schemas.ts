import {
  ISSUE_STATUSES,
  PROJECT_STATUSES,
  ACTORS,
} from "@linear-matti/shared";
import { z } from "zod";

/**
 * Response schemas for the REST API. `packages/shared` holds the INPUT schemas (and enums);
 * the dashboard parses what the API returns with these. Unknown keys are tolerated so the
 * API can add fields without breaking the dashboard.
 */

export const issueCountsSchema = z.record(z.enum(ISSUE_STATUSES), z.number().int());
export type IssueCounts = z.infer<typeof issueCountsSchema>;

export const projectSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(PROJECT_STATUSES),
  createdBy: z.enum(ACTORS),
  createdAt: z.string(),
  updatedAt: z.string(),
  issueCounts: issueCountsSchema.optional(),
});
export type Project = z.infer<typeof projectSchema>;

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
