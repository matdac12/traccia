import { z } from "zod";
import { ACTORS } from "./enums.js";
import { actorSchema, issueStatusSchema, prioritySchema } from "./schemas.js";

// Input schemas for issue listing and Kanban position (TRC-26).

export const ISSUE_ORDER_BYS = [
  "updatedAt",
  "createdAt",
  "priority",
  "sortOrder",
  "title",
] as const;
export type IssueOrderBy = (typeof ISSUE_ORDER_BYS)[number];

/** Accepts one value or an array, always yields an array. */
const repeatable = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) => (v === undefined || Array.isArray(v) ? v : [v]),
    z.array(item),
  );

export const listIssuesInputSchema = z.object({
  /** Project id, name or key (see `resolveProject`). */
  project: z.string().min(1).optional(),
  /** Repeatable; values are OR-ed. */
  status: repeatable(issueStatusSchema).optional(),
  assignee: z.enum([...ACTORS, "none"]).optional(),
  /** Repeatable label names; the issue must have ALL of them. */
  label: repeatable(z.string().trim().min(1)).optional(),
  /** Milestone id, or name (within `project` when given). */
  milestone: z.string().min(1).optional(),
  /** Parent issue identifier or id: lists that issue's sub-issues. */
  parent: z.string().min(1).optional(),
  priority: prioritySchema.optional(),
  createdBy: actorSchema.optional(),
  /** ISO timestamp; only issues updated strictly after it. */
  updatedAfter: z.iso.datetime().optional(),
  /** Free-text search over titles, descriptions and comments (FTS5). */
  q: z.string().optional(),
  includeDeleted: z.boolean().optional(),
  orderBy: z.enum(ISSUE_ORDER_BYS).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.number().int().min(1).optional(),
  /** Opaque cursor returned as `nextCursor` by the previous page. */
  cursor: z.string().min(1).optional(),
});
export type ListIssuesInput = z.input<typeof listIssuesInputSchema>;

export const moveIssuePositionInputSchema = z.object({
  /** Issue identifier (`MAT-12`) or id. */
  identifier: z.string().min(1),
  /** Target column. */
  status: issueStatusSchema,
  /** Place the issue directly above this issue (identifier or id). */
  beforeId: z.string().min(1).optional(),
  /** Place the issue directly below this issue (identifier or id). */
  afterId: z.string().min(1).optional(),
  /** Last seen `updatedAt`; a stale value is a `conflict`. */
  expectedUpdatedAt: z.string().optional(),
});
export type MoveIssuePositionInput = z.input<
  typeof moveIssuePositionInputSchema
>;
