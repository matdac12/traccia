import { z } from "zod";
import { PROJECT_STATUSES } from "./enums.js";
import { colorSchema, dateOnlySchema, issueKeySchema } from "./schemas.js";

// Argument shapes for the MCP tools (spec Appendix A). Raw shapes, because the
// MCP SDK builds the object schema itself. Descriptions are terse on purpose:
// they are sent to the agent in every session.

export const projectRefSchema = z
  .string()
  .describe("Project key (e.g. ABC), name, or id.");

export const mcpPaginationShape = {
  limit: z.number().int().min(1).max(250).optional().describe("Default 50."),
  cursor: z
    .string()
    .optional()
    .describe("From a previous response's nextCursor."),
};

export const listProjectsToolShape = {
  query: z.string().optional().describe("Match against name/key."),
  status: z.enum(PROJECT_STATUSES).optional(),
  includeDeleted: z
    .boolean()
    .optional()
    .describe("Include soft-deleted projects (flagged deleted:true)."),
  ...mcpPaginationShape,
};

export const getProjectToolShape = {
  project: projectRefSchema,
  includeMilestones: z.boolean().optional().describe("Default true."),
};

export const saveProjectToolShape = {
  id: z.string().optional().describe("Omit to create."),
  name: z.string().min(1).optional().describe("Required on create."),
  key: issueKeySchema
    .optional()
    .describe(
      "Issue prefix. Omit to use the default (MAT). Cannot be changed after creation.",
    ),
  description: z.string().optional().describe("Markdown."),
  status: z.enum(PROJECT_STATUSES).optional(),
};

const purgeSchema = z
  .boolean()
  .optional()
  .describe(
    "Permanent removal; default false. Only works on already-deleted items, and agents cannot purge unless the server allows it.",
  );

export const deleteProjectToolShape = {
  project: projectRefSchema,
  purge: purgeSchema,
};

export const listMilestonesToolShape = {
  project: projectRefSchema.optional().describe("Omit for all projects."),
  includeDeleted: z.boolean().optional(),
  ...mcpPaginationShape,
};

export const saveMilestoneToolShape = {
  id: z.string().optional().describe("Omit to create."),
  project: projectRefSchema.optional().describe("Required on create."),
  name: z.string().min(1).optional().describe("Required on create."),
  description: z.string().optional().describe("Markdown."),
  targetDate: dateOnlySchema
    .nullable()
    .optional()
    .describe("YYYY-MM-DD; null clears."),
};

export const deleteMilestoneToolShape = {
  id: z.string(),
  purge: purgeSchema,
};

export const listIssueLabelsToolShape = {
  project: projectRefSchema
    .optional()
    .describe("Include this project's labels plus global ones."),
  ...mcpPaginationShape,
};

export const saveIssueLabelToolShape = {
  id: z.string().optional().describe("Omit to create."),
  name: z.string().min(1).optional().describe("Required on create."),
  color: colorSchema.optional(),
  project: projectRefSchema
    .nullable()
    .optional()
    .describe("Omit/null = global label. Cannot change on update."),
};

export const RESTORE_TYPES = [
  "issue",
  "comment",
  "project",
  "milestone",
  "attachment",
] as const;

export const restoreToolShape = {
  type: z.enum(RESTORE_TYPES),
  id: z.string().describe("Identifier (ABC-123) for issues; id for others."),
};
