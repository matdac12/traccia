import {
  createMilestoneInputSchema,
  listMilestonesQuerySchema,
  purgeQuerySchema,
  updateMilestoneInputSchema,
} from "@traccia/shared";
import type { Hono } from "hono";
import { createServices } from "../service/index.js";
import type { AppContainer, AppEnv } from "./env.js";
import { pageOfArray } from "./page-array.js";
import { paginationQuery } from "./pagination.js";
import { ifMatch, validateBody, validateQuery } from "./validate.js";

export function mountMilestoneRoutes(
  v1: Hono<AppEnv>,
  container: AppContainer,
) {
  const { config, db } = container;
  const { milestones, stats, trash } = createServices({
    db,
    defaultIssueKey: config.defaultIssueKey,
    allowAgentPurge: config.allowAgentPurge,
  });
  const withProgress = (rows: ReturnType<typeof milestones.list>) => {
    const progress = stats.progressByMilestone(rows.map((m) => m.id));
    return rows.map((m) => ({ ...m, progress: progress.get(m.id) }));
  };

  v1.get("/projects/:idOrKey/milestones", (c) => {
    const { includeDeleted } = validateQuery(c, listMilestonesQuerySchema);
    const page = validateQuery(c, paginationQuery);
    const result = pageOfArray(
      milestones.list(c.req.param("idOrKey"), { includeDeleted }),
      page,
    );
    return c.json({ ...result, items: withProgress(result.items) });
  });

  v1.post("/projects/:idOrKey/milestones", async (c) => {
    const input = await validateBody(c, createMilestoneInputSchema);
    const [created] = withProgress([
      milestones.create(c.get("actor"), c.req.param("idOrKey"), input),
    ]);
    return c.json(created, 201);
  });

  v1.get("/milestones/:id", (c) =>
    c.json(withProgress([milestones.get(c.req.param("id"))])[0]),
  );

  v1.patch("/milestones/:id", async (c) => {
    const input = await validateBody(c, updateMilestoneInputSchema);
    input.expectedUpdatedAt ??= ifMatch(c);
    return c.json(
      withProgress([milestones.update(c.req.param("id"), input)])[0],
    );
  });

  v1.delete("/milestones/:id", async (c) => {
    const { purge } = validateQuery(c, purgeQuerySchema);
    const result = await trash.delete(
      c.get("actor"),
      "milestone",
      c.req.param("id"),
      { purge },
    );
    return c.json({ ...result, deleted: true, purged: purge === true });
  });
}
