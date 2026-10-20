import "server-only";
import { createMilestoneInputSchema, type CreateMilestoneInput, updateMilestoneInputSchema, type UpdateMilestoneInput } from "@traccia/shared";
import { api } from "./client";
import { deletedResultSchema, milestoneSchema } from "./schemas";

export function createMilestone(projectId: string, body: CreateMilestoneInput) {
  return api().request(`/projects/${encodeURIComponent(projectId)}/milestones`, { schema: milestoneSchema, method: "POST", bodySchema: createMilestoneInputSchema, body });
}

export function updateMilestone(id: string, body: UpdateMilestoneInput) {
  return api().request(`/milestones/${encodeURIComponent(id)}`, { schema: milestoneSchema, method: "PATCH", bodySchema: updateMilestoneInputSchema, body });
}

/** Soft delete (restorable from the trash). */
export function deleteMilestone(id: string) {
  return api().request(`/milestones/${encodeURIComponent(id)}`, { schema: deletedResultSchema, method: "DELETE" });
}
