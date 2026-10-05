import {
  ACTIVITY_TYPES,
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

// ---- Issue detail (MAT-1721) ----

export const labelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  projectId: z.string().nullable(),
});
export type Label = z.infer<typeof labelSchema>;

export const milestoneSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  targetDate: z.string().nullable(),
});
export type Milestone = z.infer<typeof milestoneSchema>;

/** Issues carry their full label objects. */
export const issueSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string(),
  number: z.number().int(),
  identifier: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(ISSUE_STATUSES),
  priority: z.number().int().min(0).max(4),
  estimate: z.number().int().nullable(),
  assignee: z.enum(ACTORS).nullable(),
  milestoneId: z.string().nullable(),
  parentId: z.string().nullable(),
  createdBy: z.enum(ACTORS),
  createdAt: z.string(),
  updatedAt: z.string(),
  labels: z.array(labelSchema),
});
export type Issue = z.infer<typeof issueSchema>;

const commentBaseSchema = z.object({
  id: z.string(),
  issueId: z.string(),
  parentId: z.string().nullable(),
  body: z.string(),
  actor: z.enum(ACTORS),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Reply = z.infer<typeof commentBaseSchema>;

/** A top-level comment with its replies (one level, as the API nests them). */
export const commentSchema = commentBaseSchema.extend({ replies: z.array(commentBaseSchema).default([]) });
export type Comment = z.infer<typeof commentSchema>;

/** `data` is a JSON string in the issue's `activity`; unparseable data becomes `{}`. */
export const activitySchema = z.object({
  id: z.string(),
  issueId: z.string(),
  actor: z.enum(ACTORS),
  type: z.enum(ACTIVITY_TYPES),
  data: z.unknown().transform((v): Record<string, unknown> => {
    let value = v;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        return {};
      }
    }
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }),
  createdAt: z.string(),
});
export type ActivityRow = z.infer<typeof activitySchema>;

/** Slot for MAT-1725: the dashboard only counts attachments for now. */
export const attachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  commentId: z.string().nullable(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const issueRefSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  status: z.enum(ISSUE_STATUSES),
});
export type IssueRef = z.infer<typeof issueRefSchema>;

export const relationsSchema = z.object({
  blockedBy: z.array(issueRefSchema),
  blocks: z.array(issueRefSchema),
});

export const issueDetailSchema = issueSchema.extend({
  comments: z.array(commentSchema),
  activity: z.array(activitySchema),
  attachments: z.array(attachmentSchema),
  children: z.array(issueSchema),
  relations: relationsSchema,
});
export type IssueDetail = z.infer<typeof issueDetailSchema>;

export const searchHitSchema = z.object({ issueId: z.string(), identifier: z.string(), title: z.string() });
