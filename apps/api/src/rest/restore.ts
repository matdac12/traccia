import { restoreBodySchema } from "@linear-matti/shared";
import type { Hono } from "hono";
import { createServices } from "../service/index.js";
import type { AppContainer, AppEnv } from "./env.js";
import { validateBody } from "./validate.js";

export function mountRestoreRoutes(v1: Hono<AppEnv>, container: AppContainer) {
  const { config, db } = container;
  const { trash } = createServices({
    db,
    defaultIssueKey: config.defaultIssueKey,
    allowAgentPurge: config.allowAgentPurge,
  });

  v1.post("/restore", async (c) => {
    const { type, id } = await validateBody(c, restoreBodySchema);
    return c.json(trash.restore(c.get("actor"), type, id));
  });
}
