"use server";
import {
  createLabelInputSchema,
  createMilestoneInputSchema,
  projectStatusSchema,
  updateLabelInputSchema,
  updateMilestoneInputSchema,
  updateProjectInputSchema,
} from "@traccia/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, success, toFailure, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import { createLabel, deleteLabel, updateLabel } from "@/lib/api/labels";
import { createMilestone, deleteMilestone, updateMilestone } from "@/lib/api/milestones";
import { deleteProject, updateProject } from "@/lib/api/projects";
import { restoreItem } from "@/lib/api/trash";

const noInput = z.object({});

/** Validate with the shared schema, call the API, refresh the project page. */
async function run<S extends z.ZodType>(projectId: string, schema: S, input: unknown, call: (data: z.output<S>) => Promise<unknown>): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return failure("Fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    await call(parsed.data);
  } catch (err) {
    const result = toFailure(err);
    // On a conflict the page refreshes to the latest version; the caller keeps the user's draft.
    if (!result.ok && result.conflict) revalidatePath(`/projects/${projectId}`);
    return result;
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  return success(undefined);
}

/** `expectedUpdatedAt` is the project's `updatedAt` as the user last saw it; a stale value is a conflict and nothing is saved. */
export async function updateProjectDescriptionAction(projectId: string, description: string, expectedUpdatedAt: string) {
  return run(projectId, updateProjectInputSchema.pick({ description: true, expectedUpdatedAt: true }), { description, expectedUpdatedAt }, (d) => updateProject(projectId, d));
}

export async function updateProjectStatusAction(projectId: string, status: string, expectedUpdatedAt: string) {
  return run(projectId, z.object({ status: projectStatusSchema, expectedUpdatedAt: z.string() }), { status, expectedUpdatedAt }, (d) => updateProject(projectId, d));
}

/** The project's key is not editable (ADR 0002): only the name is sent. */
export async function updateProjectNameAction(projectId: string, name: string, expectedUpdatedAt: string) {
  return run(projectId, updateProjectInputSchema.pick({ name: true, expectedUpdatedAt: true }), { name, expectedUpdatedAt }, (d) => updateProject(projectId, d));
}

/**
 * Soft delete (Trash). Like issue delete, nothing is revalidated here: re-rendering this page now would 404 and
 * replace the undo notice. `restoreProjectAction` refreshes the layout (sidebar, project picker) again.
 */
export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  try {
    await deleteProject(projectId);
  } catch (err) {
    return toFailure(err);
  }
  return success(undefined);
}

export async function restoreProjectAction(projectId: string): Promise<ActionResult> {
  try {
    await restoreItem("project", projectId);
  } catch (err) {
    return toFailure(err);
  }
  revalidatePath("/", "layout");
  return success(undefined);
}

export type MilestoneFormValues = { name: string; /** `YYYY-MM-DD`, or empty for none. */ targetDate: string };

export async function createMilestoneAction(projectId: string, values: MilestoneFormValues) {
  return run(projectId, createMilestoneInputSchema, { name: values.name, targetDate: values.targetDate || null }, (d) => createMilestone(projectId, d));
}

export async function updateMilestoneAction(projectId: string, id: string, values: MilestoneFormValues, expectedUpdatedAt: string) {
  return run(projectId, updateMilestoneInputSchema, { name: values.name, targetDate: values.targetDate || null, expectedUpdatedAt }, (d) => updateMilestone(id, d));
}

/** Soft delete: the milestone can be restored from the trash. */
export async function deleteMilestoneAction(projectId: string, id: string) {
  return run(projectId, noInput, {}, () => deleteMilestone(id));
}

export type LabelFormValues = { name: string; color: string; /** Project-scoped (true) or global. */ scoped: boolean };

export async function createLabelAction(projectId: string, values: LabelFormValues) {
  return run(projectId, createLabelInputSchema, { name: values.name, color: values.color, project: values.scoped ? projectId : null }, (d) => createLabel(d));
}

export async function updateLabelAction(projectId: string, id: string, values: Pick<LabelFormValues, "name" | "color">) {
  return run(projectId, updateLabelInputSchema, values, (d) => updateLabel(id, d));
}

/** Permanent (labels have no trash); the UI asks for confirmation first. */
export async function deleteLabelAction(projectId: string, id: string) {
  return run(projectId, noInput, {}, () => deleteLabel(id));
}
