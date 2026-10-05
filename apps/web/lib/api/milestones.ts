import "server-only";
import type { CreateMilestoneInput, UpdateMilestoneInput } from "@linear-matti/shared";
import { api } from "./client";
import { deletedResultSchema, milestoneSchema, pageOf } from "./schemas";

export async function listMilestones(projectId: string) {
  const page = await api().request(`/projects/${encodeURIComponent(projectId)}/milestones`, {
    schema: pageOf(milestoneSchema),
    query: { limit: 250 },
  });
  return page.items;
}

export function createMilestone(projectId: string, body: CreateMilestoneInput) {
  return api().request(`/projects/${encodeURIComponent(projectId)}/milestones`, { schema: milestoneSchema, method: "POST", body });
}

export function updateMilestone(id: string, body: UpdateMilestoneInput) {
  return api().request(`/milestones/${encodeURIComponent(id)}`, { schema: milestoneSchema, method: "PATCH", body });
}

/** Soft delete (restorable from the trash). */
export function deleteMilestone(id: string) {
  return api().request(`/milestones/${encodeURIComponent(id)}`, { schema: deletedResultSchema, method: "DELETE" });
}
