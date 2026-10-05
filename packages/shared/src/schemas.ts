import { z } from "zod";
import { ACTORS, PROJECT_STATUSES } from "./enums.js";

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
