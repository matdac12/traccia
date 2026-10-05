import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { resolveClientIp } from "./client-ip.js";
import type { AppContainer, AppEnv } from "./env.js";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Assigns a request id and client IP, and logs one line per request.
 * Only an allowlist of fields is logged; headers (notably Authorization)
 * are never read into the log.
 */
export function requestContext(
  container: AppContainer,
): MiddlewareHandler<AppEnv> {
  const { logger, config } = container;
  return async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId =
      incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    c.set("requestId", requestId);
    c.set("clientIp", resolveClientIp(c, config.trustProxy));
    c.set("logger", logger);
    c.set("container", container);
    c.header("X-Request-Id", requestId);

    const start = performance.now();
    await next();
    logger.info("request", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
      ip: c.get("clientIp"),
    });
  };
}
