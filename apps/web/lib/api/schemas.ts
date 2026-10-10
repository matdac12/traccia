import {
  ACTIVITY_TYPES,
  ISSUE_STATUSES,
  PROJECT_STATUSES,
  ACTORS,
} from "@traccia/shared";
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
  /** Parent issue (id) for sub-issues. */
  parentId: z.string().nullable(),
  /** Project (id and name) the item belongs to; a project is its own. */
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  /** Who deleted it; null for items deleted before this was recorded. */
  deletedBy: z.enum(["agent", "you"]).nullable(),
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
  updatedAt: z.string(),
  /** Done issues out of live, non-canceled ones. */
  progress: milestoneProgressSchema.optional(),
});
export type Milestone = z.infer<typeof milestoneSchema>;

/** A project as `GET /projects?include=milestones` returns it. */
export const projectWithMilestonesSchema = projectSchema.extend({ milestones: z.array(milestoneSchema) });
export type ProjectWithMilestones = z.infer<typeof projectWithMilestonesSchema>;

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
export type IssueRow = z.infer<typeof issueSchema>;
export type Issue = IssueRow;

/** `GET /issues/groups`: one page per status plus the sync token read just before them. */
export const issueGroupsSchema = z.object({
  groups: z.array(z.object({ status: z.enum(ISSUE_STATUSES), items: z.array(issueSchema), nextCursor: z.string().nullable() })),
  syncToken: z.string(),
});

export const deletedResultSchema = z.object({ deleted: z.literal(true) }).loose();

// ---- Issue detail (TRC-47) ----

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

/** A row of `GET /activity`: an activity row plus the issue it belongs to. */
export const activityFeedItemSchema = activitySchema.extend({ identifier: z.string(), title: z.string() });
export type ActivityFeedItem = z.infer<typeof activityFeedItemSchema>;

/** A file on an issue (TRC-51). `actor` and `createdAt` come with every attachment the API returns. */
export const attachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  commentId: z.string().nullable(),
  actor: z.enum(ACTORS),
  createdAt: z.string(),
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
  /** Symmetric, non-blocking links; the same list appears on both issues. */
  related: z.array(issueRefSchema).default([]),
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

// ---- Documentation (TRC-130): memories and documents ----

/** A memory as `GET /projects/:id/memories` and `GET /memories/:id` return it (full markdown body). */
export const memorySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  createdBy: z.enum(ACTORS),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Memory = z.infer<typeof memorySchema>;

/** A file on a project. `url` (the API's public link) is ignored: the browser uses the proxy route. */
export const documentSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  description: z.string(),
  createdBy: z.enum(ACTORS),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectDocument = z.infer<typeof documentSchema>;
