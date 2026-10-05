import { activityQuerySchema } from "@linear-matti/shared";
import type { Hono } from "hono";
import type { AppContainer, AppEnv } from "./env.js";
import { servicesFor } from "./services.js";
import { validateQuery } from "./validate.js";

/** `GET /v1/activity`: recent activity across issues, newest first. */
export function mountActivityRoutes(v1: Hono<AppEnv>, container: AppContainer) {
  const { activityFeed } = servicesFor(container);
  v1.get("/activity", (c) =>
    c.json(activityFeed.list(validateQuery(c, activityQuerySchema))),
  );
}
