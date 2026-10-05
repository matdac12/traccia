import { searchQuerySchema } from "@linear-matti/shared";
import type { Hono } from "hono";
import type { AppContainer, AppEnv } from "./env.js";
import { servicesFor } from "./services.js";
import { validateQuery } from "./validate.js";

/**
 * `GET /v1/search?q=&project=`: one result per issue, best match first.
 * `snippet` wraps hits in `<mark>…</mark>` but the surrounding text is raw
 * issue/comment text and NOT HTML-escaped: the dashboard must escape it
 * (then re-enable the mark tags) before rendering it as HTML.
 */
export function mountSearchRoutes(v1: Hono<AppEnv>, container: AppContainer) {
  const { search } = servicesFor(container);
  v1.get("/search", (c) =>
    c.json(search.search(validateQuery(c, searchQuerySchema))),
  );
}
