import {
  createLabelInputSchema,
  listLabelsQuerySchema,
  updateLabelInputSchema,
} from "@linear-matti/shared";
import type { Hono } from "hono";
import { createServices } from "../service/index.js";
import type { AppContainer, AppEnv } from "./env.js";
import { pageOfArray } from "./page-array.js";
import { paginationQuery } from "./pagination.js";
import { validateBody, validateQuery } from "./validate.js";

/** Label deletion is REST-only: the MCP layer does not expose it. */
export function mountLabelRoutes(v1: Hono<AppEnv>, container: AppContainer) {
  const { config, db } = container;
  const { labels } = createServices({
    db,
    defaultIssueKey: config.defaultIssueKey,
    allowAgentPurge: config.allowAgentPurge,
  });

  v1.get("/labels", (c) => {
    const filter = validateQuery(c, listLabelsQuerySchema);
    const page = validateQuery(c, paginationQuery);
    return c.json(pageOfArray(labels.list(filter), page));
  });

  v1.post("/labels", async (c) => {
    const input = await validateBody(c, createLabelInputSchema);
    return c.json(labels.create(input), 201);
  });

  v1.patch("/labels/:id", async (c) => {
    const input = await validateBody(c, updateLabelInputSchema);
    return c.json(labels.update(c.req.param("id"), input));
  });

  v1.delete("/labels/:id", (c) => {
    const label = labels.delete(c.req.param("id"));
    return c.json({ id: label.id, deleted: true });
  });
}
