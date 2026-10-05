import "server-only";
import type { CreateLabelInput, UpdateLabelInput } from "@linear-matti/shared";
import { api } from "./client";
import { deletedResultSchema, labelSchema, pageOf } from "./schemas";

/** Global labels plus, with `project`, that project's own labels; with no argument, global labels only. */
export async function listLabels(project?: string) {
  const page = await api().request("/labels", { schema: pageOf(labelSchema), query: { project, limit: 250 } });
  return page.items;
}

export function createLabel(body: CreateLabelInput) {
  return api().request("/labels", { schema: labelSchema, method: "POST", body });
}

export function updateLabel(id: string, body: UpdateLabelInput) {
  return api().request(`/labels/${encodeURIComponent(id)}`, { schema: labelSchema, method: "PATCH", body });
}

/** Dashboard-only, permanent: labels have no trash. */
export function deleteLabel(id: string) {
  return api().request(`/labels/${encodeURIComponent(id)}`, { schema: deletedResultSchema, method: "DELETE" });
}
