import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { Db } from "../db/connection.js";
import { tokens } from "../db/schema.js";
import type { AppEnv } from "../rest/env.js";
import { RateLimitedError, UnauthorizedError } from "../service/errors.js";
import { nowIso } from "../time.js";
import { RateLimiter } from "./rate-limit.js";
import type { VerifyCredential } from "./verifier.js";

const LAST_USED_INTERVAL_MS = 60_000;

/**
 * Authenticates the request, stamps `actor`/`tokenId`/`tokenName` on the
 * context, rate limits per token and records `last_used_at` at most once a
 * minute per token.
 */
export function requireAuth(options: {
  verify: VerifyCredential;
  db: Db;
  rateLimitPerMin: number;
}): MiddlewareHandler<AppEnv> {
  const { verify, db } = options;
  const limiter = new RateLimiter(options.rateLimitPerMin);
  const lastWrite = new Map<string, number>();

  return async (c, next) => {
    const credential = await verify(c.req.raw);
    if (!credential) throw new UnauthorizedError();

    const now = Date.now();
    const retryAfter = limiter.hit(credential.tokenId, now);
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      throw new RateLimitedError("Rate limit exceeded", { retryAfter });
    }

    const previous = lastWrite.get(credential.tokenId);
    if (previous === undefined || now - previous >= LAST_USED_INTERVAL_MS) {
      lastWrite.set(credential.tokenId, now);
      db.update(tokens)
        .set({ lastUsedAt: nowIso() })
        .where(eq(tokens.id, credential.tokenId))
        .run();
    }

    c.set("actor", credential.actor);
    c.set("tokenId", credential.tokenId);
    c.set("tokenName", credential.tokenName);
    await next();
  };
}
