import { z } from "zod";
import {
  ACTORS,
  ISSUE_STATUSES,
  PRIORITIES,
  type Priority,
  PROJECT_STATUSES,
} from "./enums.js";

// Zod input schemas shared by the service layer, REST and MCP.

export const actorSchema = z.enum(ACTORS);
export const projectStatusSchema = z.enum(PROJECT_STATUSES);

/** Matches the `issue_keys_key_format` CHECK: `[A-Z][A-Z0-9]*`, 2 to 8 chars. */
export const issueKeySchema = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9]{1,7}$/,
    "must be 2-8 characters: uppercase letters and digits, starting with a letter",
  );

const nameSchema = z.string().trim().min(1, "must not be empty");

/** `YYYY-MM-DD`, and a real calendar date (rejects `2026-02-30`). */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be formatted YYYY-MM-DD")
  .refine(
    (s) => {
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
    },
    { message: "is not a valid calendar date" },
  );

export const createProjectInputSchema = z.object({
  name: nameSchema,
  description: z.string().optional(),
  /** Omit to use the configured default key (`DEFAULT_ISSUE_KEY`). */
  key: issueKeySchema.optional(),
  status: projectStatusSchema.optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const updateProjectInputSchema = z.object({
  name: nameSchema.optional(),
  description: z.string().optional(),
  status: projectStatusSchema.optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

export const listProjectsInputSchema = z.object({
  status: projectStatusSchema.optional(),
  includeDeleted: z.boolean().optional(),
});
export type ListProjectsInput = z.infer<typeof listProjectsInputSchema>;

export const createMilestoneInputSchema = z.object({
  name: nameSchema,
  description: z.string().optional(),
  targetDate: dateOnlySchema.nullable().optional(),
  sortOrder: z.number().finite().optional(),
});
export type CreateMilestoneInput = z.infer<typeof createMilestoneInputSchema>;

export const updateMilestoneInputSchema = z.object({
  name: nameSchema.optional(),
  description: z.string().optional(),
  /** `null` clears the date. */
  targetDate: dateOnlySchema.nullable().optional(),
  sortOrder: z.number().finite().optional(),
});
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneInputSchema>;

// ---- Issues ----

/**
 * Status input: case-insensitive, accepts display names and separators, so
 * `"In Progress"`, `"in-progress"` and `"in_progress"` all give `in_progress`.
 */
export const issueStatusSchema = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, "_")
      : v,
  z.enum(ISSUE_STATUSES, {
    message: `must be one of: ${ISSUE_STATUSES.join(", ")}`,
  }),
);

const PRIORITY_NAMES: Record<string, Priority> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

/** Priority input: a number 0-4, its numeric string, or a name (case-insensitive). */
export const prioritySchema = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    const s = v.trim().toLowerCase();
    if (s in PRIORITY_NAMES) return PRIORITY_NAMES[s];
    return /^\d$/.test(s) ? Number(s) : v;
  },
  z
    .number()
    .refine(
      (n): n is Priority => (PRIORITIES as readonly number[]).includes(n),
      {
        message: "must be 0-4 or one of: none, urgent, high, medium, low",
      },
    ),
);

export const estimateSchema = z.number().int().min(0);

const issueTitleSchema = z.string().trim().min(1, "must not be empty");

export const createIssueInputSchema = z.object({
  /** Project id, name or key (see `resolveProject`). */
  project: z.string().min(1),
  title: issueTitleSchema,
  description: z.string().optional(),
  status: issueStatusSchema.optional(),
  priority: prioritySchema.optional(),
  estimate: estimateSchema.nullable().optional(),
  assignee: actorSchema.nullable().optional(),
  milestoneId: z.string().min(1).nullable().optional(),
  /** Pass-through: must be a live issue in the same project. */
  parentId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().finite().optional(),
});
export type CreateIssueInput = z.input<typeof createIssueInputSchema>;

export const updateIssueInputSchema = z.object({
  title: issueTitleSchema.optional(),
  description: z.string().optional(),
  status: issueStatusSchema.optional(),
  priority: prioritySchema.optional(),
  estimate: estimateSchema.nullable().optional(),
  assignee: actorSchema.nullable().optional(),
  milestoneId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().finite().optional(),
  /** Optimistic concurrency: the `updatedAt` the caller last saw. */
  expectedUpdatedAt: z.string().optional(),
});
export type UpdateIssueInput = z.input<typeof updateIssueInputSchema>;

export const ISSUE_INCLUDES = [
  "comments",
  "activity",
  "attachments",
  "children",
  "relations",
] as const;
export type IssueInclude = (typeof ISSUE_INCLUDES)[number];
