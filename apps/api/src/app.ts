import { Hono } from "hono";
import { requireAuth } from "./auth/middleware.js";
import { createBearerVerifier } from "./auth/verifier.js";
import { createMcpRoute } from "./mcp/route.js";
import { mountAttachmentRoutes } from "./rest/attachments.js";
import type { AppContainer, AppEnv } from "./rest/env.js";
import { errorHandler, notFoundHandler } from "./rest/errors.js";
import { requestContext } from "./rest/request-context.js";

/**
 * Builds the Hono app. Unauthenticated routes (/healthz) are mounted on the
 * root; every authenticated route belongs on `v1`, which is where auth
 * middleware will be attached later.
 */
export function createApp(
  container: AppContainer,
  mcpDeps?: Parameters<typeof createMcpRoute>[1],
) {
  const app = new Hono<AppEnv>();
  app.use(requestContext(container));
  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.get("/healthz", (c) => c.json({ ok: true }));

  const v1 = new Hono<AppEnv>();
  const auth = requireAuth({
    verify: createBearerVerifier(container.db),
    db: container.db,
    rateLimitPerMin: container.config.rateLimitPerMin,
  });
  v1.use(auth);
  v1.get("/me", (c) =>
    c.json({ actor: c.get("actor"), tokenName: c.get("tokenName") }),
  );
  mountAttachmentRoutes(app, v1, container, auth);
  app.route("/v1", v1);
  app.route("/mcp", createMcpRoute(container, mcpDeps));

  return app;
}

export type App = ReturnType<typeof createApp>;
