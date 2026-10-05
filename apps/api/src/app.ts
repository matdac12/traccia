import { Hono } from "hono";
import { errorHandler, notFoundHandler } from "./rest/errors.js";
import type { AppContainer, AppEnv } from "./rest/env.js";
import { requestContext } from "./rest/request-context.js";

/**
 * Builds the Hono app. Unauthenticated routes (/healthz) are mounted on the
 * root; every authenticated route belongs on `v1`, which is where auth
 * middleware will be attached later.
 */
export function createApp(container: AppContainer) {
  const app = new Hono<AppEnv>();
  app.use(requestContext(container));
  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.get("/healthz", (c) => c.json({ ok: true }));

  const v1 = new Hono<AppEnv>();
  app.route("/v1", v1);

  return app;
}

export type App = ReturnType<typeof createApp>;
