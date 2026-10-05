import "server-only";
import type { CreateProjectInput, UpdateProjectInput } from "@traccia/shared";
import { notFound } from "next/navigation";
import { cache } from "react";
import { api, ApiError } from "./client";
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

/** `cache` shares one fetch between the project layout and its pages in the same request. */
export const getProject = cache((idOrKey: string) => api().request(`/projects/${encodeURIComponent(idOrKey)}`, { schema: projectSchema }));

/** `getProject` for a page or layout: an unknown project renders the route'"'"'s not-found page. */
export function getProjectOr404(idOrKey: string) {
  return getProject(idOrKey).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
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
