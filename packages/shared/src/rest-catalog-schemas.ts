import { z } from "zod";
import { projectStatusSchema } from "./schemas.js";

/** Query-string boolean: only the literal `true` / `false`. */
export const queryBooleanSchema = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

export const listProjectsQuerySchema = z.object({
  status: projectStatusSchema.optional(),
  includeDeleted: queryBooleanSchema.optional(),
  /** `include=milestones` embeds each project's milestones (with progress). */
  include: z.enum(["milestones"]).optional(),
});

export const getProjectQuerySchema = z.object({
  includeDeleted: queryBooleanSchema.optional(),
});

export const listMilestonesQuerySchema = z.object({
  includeDeleted: queryBooleanSchema.optional(),
});

export const listLabelsQuerySchema = z.object({
  project: z.string().min(1).optional(),
  includeDeleted: queryBooleanSchema.optional(),
});

/** `DELETE ...?purge=true` on every deletable thing. */
export const purgeQuerySchema = z.object({
  purge: queryBooleanSchema.optional(),
});

export const RESTORE_TYPES = [
  "issue",
  "comment",
  "project",
  "milestone",
  "attachment",
  "memory",
  "document",
] as const;

/**
 * What `POST /v1/restore` accepts. To-dos are REST-only (ADR 0017), so `todo`
 * is here but not in `RESTORE_TYPES`, which the MCP `restore` tool also uses.
 */
export const REST_RESTORE_TYPES = [...RESTORE_TYPES, "todo"] as const;

export const restoreBodySchema = z.object({
  type: z.enum(REST_RESTORE_TYPES),
  id: z.string().min(1),
});
export type RestoreBody = z.infer<typeof restoreBodySchema>;
