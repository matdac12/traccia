import "server-only";
import type { CreateProjectInput, UpdateProjectInput } from "@traccia/shared";
import { api } from "./client";
import { cache } from "react";
import { deletedResultSchema, pageOf, projectSchema, projectWithMilestonesSchema } from "./schemas";

/**
 * All live projects with their milestones, following pagination (the list is small, so this is a handful of calls
 * at most). `cache` shares one fetch between the layout's sidebar and the page in the same request.
 */
export const listProjects = cache(async () => {
  const projects = [];
  let cursor: string | undefined;
  do {
    const page = await api().request("/projects", {
      schema: pageOf(projectWithMilestonesSchema),
      query: { limit: 250, cursor, include: "milestones" },
    });
    projects.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return projects;
});

export function getProject(idOrKey: string) {
  return api().request(`/projects/${encodeURIComponent(idOrKey)}`, { schema: projectSchema });
}

export function updateProject(id: string, body: UpdateProjectInput) {
  return api().request(`/projects/${encodeURIComponent(id)}`, { schema: projectSchema, method: "PATCH", body });
}

export function createProject(body: CreateProjectInput) {
  return api().request("/projects", { schema: projectSchema, method: "POST", body });
}

/** Soft delete: the project, its issues and milestones go to the trash as one batch. */
export function deleteProject(id: string) {
  return api().request(`/projects/${encodeURIComponent(id)}`, { schema: deletedResultSchema, method: "DELETE" });
}
