import { timingSafeEqual } from "node:crypto";
import type { Actor } from "@traccia/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db/connection.js";
import { tokens } from "../db/schema.js";
import { hashToken, TOKEN_PREFIX } from "../service/tokens.js";

export type Credential = { actor: Actor; tokenId: string; tokenName: string };

/**
 * Resolves the caller of a request, or null if it carries no valid
 * credential. v1 is bearer tokens; an OAuth access-token verifier can
 * implement the same signature later.
 */
export type VerifyCredential = (request: Request) => Promise<Credential | null>;

function bearerToken(request: Request): string | null {
  const match = /^bearer +(\S+)$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  return match?.[1] ?? null;
}

/** One indexed lookup per request, so revocation is effective immediately. */
export function createBearerVerifier(db: Db): VerifyCredential {
  return async (request) => {
    const token = bearerToken(request);
    if (!token?.startsWith(TOKEN_PREFIX)) return null;

    const presentedHash = hashToken(token);
    const row = db
      .select()
      .from(tokens)
      .where(eq(tokens.tokenHash, presentedHash))
      .get();
    if (!row || row.revokedAt) return null;

    // The lookup already matched; compare again in constant time so the
    // decision never rests on a short-circuiting string comparison.
    const presented = Buffer.from(presentedHash, "hex");
    const stored = Buffer.from(row.tokenHash, "hex");
    if (
      stored.length !== presented.length ||
      !timingSafeEqual(stored, presented)
    ) {
      return null;
    }
    return { actor: row.actor, tokenId: row.id, tokenName: row.name };
  };
}
