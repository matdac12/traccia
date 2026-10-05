import {
  createProjectInputSchema,
  getProjectQuerySchema,
  listProjectsQuerySchema,
  purgeQuerySchema,
  updateProjectInputSchema,
} from "@traccia/shared";
import type { Hono } from "hono";
import { createServices } from "../service/index.js";
import type { AppContainer, AppEnv } from "./env.js";
import { pageOfArray } from "./page-array.js";
import { paginationQuery } from "./pagination.js";
import { ifMatch, validateBody, validateQuery } from "./validate.js";

export function mountProjectRoutes(v1: Hono<AppEnv>, container: AppContainer) {
  const { config, db } = container;
  const { projects, milestones, stats, trash } = createServices({
    db,
    defaultIssueKey: config.defaultIssueKey,
    allowAgentPurge: config.allowAgentPurge,
  });
  const withCounts = (rows: ReturnType<typeof projects.list>) => {
    const counts = stats.issueCountsByProject(rows.map((p) => p.id));
    return rows.map((p) => ({ ...p, issueCounts: counts.get(p.id) }));
  };

  v1.get("/projects", (c) => {
    const { status, includeDeleted, include } = validateQuery(
      c,
      listProjectsQuerySchema,
    );
    const page = validateQuery(c, paginationQuery);
    const result = pageOfArray(projects.list({ status, includeDeleted }), page);
    const items = withCounts(result.items);
    if (include !== "milestones") return c.json({ ...result, items });
    // One pass for all projects: the dashboard asks for this instead of one milestones call per project.
    const embedded = items.map((p) => ({
      ...p,
      milestones: milestones.list(p.id),
    }));
    const progress = stats.progressByMilestone(
      embedded.flatMap((p) => p.milestones.map((m) => m.id)),
    );
    return c.json({
      ...result,
      items: embedded.map((p) => ({
        ...p,
        milestones: p.milestones.map((m) => ({
          ...m,
          progress: progress.get(m.id),
        })),
      })),
    });
  });

  v1.post("/projects", async (c) => {
    const input = await validateBody(c, createProjectInputSchema);
    const [created] = withCounts([projects.create(c.get("actor"), input)]);
    return c.json(created, 201);
  });

  v1.get("/projects/:idOrKey", (c) => {
    const { includeDeleted } = validateQuery(c, getProjectQuerySchema);
    const [project] = withCounts([
      projects.get(c.req.param("idOrKey"), { includeDeleted }),
    ]);
    return c.json(project);
  });

  v1.patch("/projects/:idOrKey", async (c) => {
    const input = await validateBody(c, updateProjectInputSchema);
    input.expectedUpdatedAt ??= ifMatch(c);
    const [project] = withCounts([
      projects.update(c.req.param("idOrKey"), input),
    ]);
    return c.json(project);
  });

  v1.delete("/projects/:idOrKey", async (c) => {
    const { purge } = validateQuery(c, purgeQuerySchema);
    const project = projects.get(c.req.param("idOrKey"), {
      includeDeleted: purge === true,
    });
    const result = await trash.delete(c.get("actor"), "project", project.id, {
      purge,
    });
    return c.json({ ...result, deleted: true, purged: purge === true });
  });
}
