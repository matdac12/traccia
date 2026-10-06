import { searchQuerySchema } from "@traccia/shared";
import type { Hono } from "hono";
import type { AppContainer, AppEnv } from "./env.js";
import { servicesFor } from "./services.js";
import { validateQuery } from "./validate.js";

/**
 * `GET /v1/search?q=&project=`: one result per issue, best match first. The last
 * word may be partial (prefix match). `snippet` is plain-text segments with a
 * `match` flag; the API returns no HTML, so the dashboard renders it directly.
 */
export function mountSearchRoutes(v1: Hono<AppEnv>, container: AppContainer) {
  const { search } = servicesFor(container);
  v1.get("/search", (c) =>
    c.json(search.search(validateQuery(c, searchQuerySchema))),
  );
}
