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

export const purgeQuerySchema = z.object({
  purge: queryBooleanSchema.optional(),
});

export const RESTORE_TYPES = [
  "issue",
  "comment",
  "project",
  "milestone",
  "attachment",
] as const;

export const restoreBodySchema = z.object({
  type: z.enum(RESTORE_TYPES),
  id: z.string().min(1),
});
export type RestoreBody = z.infer<typeof restoreBodySchema>;
