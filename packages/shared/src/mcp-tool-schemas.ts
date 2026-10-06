import { z } from "zod";
import { PROJECT_STATUSES } from "./enums.js";
import { RESTORE_TYPES } from "./rest-catalog-schemas.js";
import { colorSchema, dateOnlySchema, issueKeySchema } from "./schemas.js";

// Argument shapes for the MCP tools (spec Appendix A). Raw shapes, because the
// MCP SDK builds the object schema itself. Descriptions are terse on purpose:
// they are sent to the agent in every session.

const projectRefBase = z.string();

export const projectRefSchema = projectRefBase.describe(
  "Project key, name or id.",
);

/** Shared tail of every delete tool description. */
export const PURGE_NOTE =
  "purge=true permanently removes an already-deleted item; only actor 'you' (agents need ALLOW_AGENT_PURGE).";

export const mcpPaginationShape = {
  limit: z.number().int().min(1).max(250).optional(),
  cursor: z.string().optional().describe("Previous nextCursor."),
};

export const listProjectsToolShape = {
  query: z.string().optional().describe("Match against name/key."),
  status: z.enum(PROJECT_STATUSES).optional(),
  includeDeleted: z.boolean().optional(),
  ...mcpPaginationShape,
};

export const getProjectToolShape = {
  project: projectRefSchema,
  includeMilestones: z.boolean().optional().describe("Default true."),
};

export const saveProjectToolShape = {
  id: z.string().optional(),
  name: z.string().min(1).optional(),
  key: issueKeySchema
    .optional()
    .describe("Issue prefix (default MAT); fixed after creation."),
  description: z.string().optional(),
  status: z.enum(PROJECT_STATUSES).optional().describe("Default: active."),
};

const purgeSchema = z.boolean().optional();

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
  id: z.string().optional(),
  project: projectRefSchema.optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  targetDate: dateOnlySchema
    .nullable()
    .optional()
    .describe("YYYY-MM-DD; null clears."),
};

export const deleteMilestoneToolShape = {
  id: z.string().describe("Milestone id."),
  purge: purgeSchema,
};

export const listIssueLabelsToolShape = {
  project: projectRefSchema.optional().describe("Add this project's labels."),
  ...mcpPaginationShape,
};

export const saveIssueLabelToolShape = {
  id: z.string().optional(),
  name: z.string().min(1).optional(),
  color: colorSchema.optional().describe("Hex #rrggbb."),
  project: projectRefBase
    .nullable()
    .optional()
    .describe(
      "Project key, name or id; omit/null = global. Fixed after creation.",
    ),
};

export const restoreToolShape = {
  type: z.enum(RESTORE_TYPES),
  id: z.string().describe("Identifier for issues; id for others."),
};
