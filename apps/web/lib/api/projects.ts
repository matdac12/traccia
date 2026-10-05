import "server-only";
import { api } from "./client";
import { pageOf, projectSchema } from "./schemas";

/** All live projects, following pagination (the list is small, so this is a handful of calls at most). */
export async function listProjects() {
  const projects = [];
  let cursor: string | undefined;
  do {
    const page = await api().request("/projects", {
      schema: pageOf(projectSchema),
      query: { limit: 250, cursor },
    });
    projects.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return projects;
}

export function getProject(idOrKey: string) {
  return api().request(`/projects/${encodeURIComponent(idOrKey)}`, { schema: projectSchema });
}
