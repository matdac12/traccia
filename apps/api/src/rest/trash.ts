import { trashQuerySchema } from "@linear-matti/shared";
import type { Hono } from "hono";
import type { AppContainer, AppEnv } from "./env.js";
import { servicesFor } from "./services.js";
import { validateQuery } from "./validate.js";

/** `GET /v1/trash`: deleted items of every type, newest deletion first. */
export function mountTrashRoutes(v1: Hono<AppEnv>, container: AppContainer) {
  const { trash } = servicesFor(container);
  v1.get("/trash", (c) =>
    c.json(trash.list(validateQuery(c, trashQuerySchema))),
  );
}
