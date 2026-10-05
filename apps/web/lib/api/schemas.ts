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

export const TRASH_TYPES = ["project", "milestone", "issue", "comment", "attachment"] as const;
export type TrashType = (typeof TRASH_TYPES)[number];

export const trashItemSchema = z.object({
  type: z.enum(TRASH_TYPES),
  id: z.string(),
  /** Project/milestone name, "KEY-1 title" for issues, comment excerpt, attachment filename. */
  label: z.string(),
  deletedAt: z.string(),
  deletedBatch: z.string().nullable(),
  /** Owning issue (id) for comments and attachments. */
  issueId: z.string().nullable(),
});
export type TrashItem = z.infer<typeof trashItemSchema>;

const countsSchema = z.object({
  projects: z.number().int(),
  milestones: z.number().int(),
  issues: z.number().int(),
  comments: z.number().int(),
  attachments: z.number().int(),
});
export type TrashCounts = z.infer<typeof countsSchema>;

export const restoreResultSchema = z.object({ type: z.enum(TRASH_TYPES), id: z.string(), counts: countsSchema });
export type RestoreResult = z.infer<typeof restoreResultSchema>;

export const purgeResultSchema = z.object({ purged: z.literal(true) });

export const labelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  projectId: z.string().nullable(),
});
export type Label = z.infer<typeof labelSchema>;

export const milestoneProgressSchema = z.object({ done: z.number().int(), total: z.number().int() });
export type MilestoneProgress = z.infer<typeof milestoneProgressSchema>;

export const milestoneSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  targetDate: z.string().nullable(),
  /** Done issues out of live, non-canceled ones. */
  progress: milestoneProgressSchema.optional(),
});
export type Milestone = z.infer<typeof milestoneSchema>;

export const issueSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  identifier: z.string(),
  title: z.string(),
  status: z.enum(ISSUE_STATUSES),
  priority: z.number().int().min(0).max(4),
  estimate: z.number().int().nullable(),
  assignee: z.enum(ACTORS).nullable(),
  milestoneId: z.string().nullable(),
  createdBy: z.enum(ACTORS),
  updatedAt: z.string(),
  labels: z.array(labelSchema),
});
export type IssueRow = z.infer<typeof issueSchema>;

export const deletedResultSchema = z.object({ deleted: z.literal(true) }).loose();
