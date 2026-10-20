import "server-only";
import { createLabelInputSchema, type CreateLabelInput, updateLabelInputSchema, type UpdateLabelInput } from "@traccia/shared";
import { api } from "./client";
import { deletedResultSchema, labelSchema } from "./schemas";

export function createLabel(body: CreateLabelInput) {
  return api().request("/labels", { schema: labelSchema, method: "POST", bodySchema: createLabelInputSchema, body });
}

export function updateLabel(id: string, body: UpdateLabelInput) {
  return api().request(`/labels/${encodeURIComponent(id)}`, { schema: labelSchema, method: "PATCH", bodySchema: updateLabelInputSchema, body });
}

/** Dashboard-only, permanent: labels have no trash. */
export function deleteLabel(id: string) {
  return api().request(`/labels/${encodeURIComponent(id)}`, { schema: deletedResultSchema, method: "DELETE" });
}
