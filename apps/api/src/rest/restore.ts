import { restoreBodySchema } from "@traccia/shared";
import type { Hono } from "hono";
import { requireRestorable } from "../auth/scope.js";
import type { AppContainer, AppEnv } from "./env.js";
import { servicesFor } from "./services.js";
import { validateBody } from "./validate.js";

export function mountRestoreRoutes(v1: Hono<AppEnv>, container: AppContainer) {
  // The shared container, so restoring a To-do reschedules its Reminder.
  const { trash } = servicesFor(container);

  v1.post("/restore", async (c) => {
    const { type, id } = await validateBody(c, restoreBodySchema);
    requireRestorable(c.get("scope"), type);
    return c.json(trash.restore(c.get("actor"), type, id));
  });
}
