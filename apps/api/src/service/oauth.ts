import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, count, eq, isNull, lt, notExists } from "drizzle-orm";
import type { Db } from "../db/connection.js";
import {
  oauthAuthCodes,
  oauthClients,
  oauthRefreshTokens,
  tokens,
} from "../db/schema.js";
import { newId } from "../ids.js";
import { nowIso } from "../time.js";
import type { DbHandle } from "./context.js";
import { hashToken, TOKEN_PREFIX } from "./tokens.js";

export const AUTH_CODE_TTL_MS = 5 * 60_000;
export const ACCESS_TOKEN_TTL_S = 60 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
const REFRESH_PREFIX = "trr_";
const CODE_PREFIX = "trc_";

/** An OAuth protocol error: `error` is the RFC 6749 code. */
export class OAuthError extends Error {
  override name = "OAuthError";
  constructor(
    readonly error: string,
    description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

export type OAuthClient = {
  id: string;
  name: string;
  redirectUris: string[];
  createdAt: string;
};

const secret = (prefix: string) =>
  `${prefix}${randomBytes(32).toString("base64url")}`;
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

const isLoopback = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]";

/** Redirect URIs always allowed, on top of any configured extras. */
export const DEFAULT_REDIRECT_URIS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

/** https, or http on a loopback host (native clients); no fragment, no credentials. */
export function isAcceptableRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" && isLoopback(url.hostname))
  );
}

/**
 * Whether a redirect URI may be registered or used at all: an exact match
 * against the default and configured allowlist, or an http loopback URI on any
 * port (RFC 8252). Anything else could hand an authorization code, or phish the
 * admin secret, to an attacker's site.
 */
export function isAllowedRedirectUri(
  value: string,
  extraAllowed: readonly string[] = [],
): boolean {
  if (!isAcceptableRedirectUri(value)) return false;
  if (DEFAULT_REDIRECT_URIS.includes(value) || extraAllowed.includes(value)) {
    return true;
  }
  return new URL(value).protocol === "http:";
}

export type ClientLimits = {
  /** Registrations beyond this many live clients are rejected. */
  maxClients: number;
  /** A client with no authorization code issued is deleted after this long. */
  unusedClientTtlMs: number;
};

export const DEFAULT_CLIENT_LIMITS: ClientLimits = {
  maxClients: 100,
  unusedClientTtlMs: 60 * 60_000,
};

/**
 * Deletes clients that never had an authorization code issued and are older
 * than the TTL. A client with any code (so any grant) is never deleted.
 */
export function deleteExpiredClients(
  db: Db,
  ttlMs: number,
  now = Date.now(),
): number {
  const cutoff = new Date(now - ttlMs).toISOString();
  return db
    .delete(oauthClients)
    .where(
      and(
        lt(oauthClients.createdAt, cutoff),
        notExists(
          db
            .select({ one: oauthAuthCodes.clientId })
            .from(oauthAuthCodes)
            .where(eq(oauthAuthCodes.clientId, oauthClients.id)),
        ),
        notExists(
          db
            .select({ one: oauthRefreshTokens.clientId })
            .from(oauthRefreshTokens)
            .where(eq(oauthRefreshTokens.clientId, oauthClients.id)),
        ),
      ),
    )
    .run().changes;
}

export function registerClient(
  db: Db,
  input: { name: string; redirectUris: string[] },
  options: {
    extraRedirectUris?: readonly string[];
    limits?: ClientLimits;
    now?: number;
  } = {},
): OAuthClient {
  if (!input.redirectUris.length) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris is required");
  }
  for (const uri of input.redirectUris) {
    if (!isAcceptableRedirectUri(uri)) {
      throw new OAuthError(
        "invalid_redirect_uri",
        "redirect_uris must be https URLs (or http on localhost) without a fragment",
      );
    }
    if (!isAllowedRedirectUri(uri, options.extraRedirectUris)) {
      throw new OAuthError(
        "invalid_redirect_uri",
        "redirect_uri is not on this server's allowlist",
      );
    }
  }
  const limits = options.limits ?? DEFAULT_CLIENT_LIMITS;
  const now = options.now ?? Date.now();
  // Lazy cleanup: expired unused clients are dropped as part of registering.
  deleteExpiredClients(db, limits.unusedClientTtlMs, now);
  const total = db.select({ n: count() }).from(oauthClients).get()?.n ?? 0;
  if (total >= limits.maxClients) {
    throw new OAuthError(
      "temporarily_unavailable",
      "Too many registered clients; try again later",
      503,
    );
  }
  const client: OAuthClient = {
    id: `trc_client_${newId()}`,
    name: input.name,
    redirectUris: [...new Set(input.redirectUris)],
    createdAt: new Date(now).toISOString(),
  };
  db.insert(oauthClients)
    .values({
      id: client.id,
      name: client.name,
      redirectUris: JSON.stringify(client.redirectUris),
      createdAt: client.createdAt,
    })
    .run();
  return client;
}

export function findClient(db: DbHandle, id: string): OAuthClient | null {
  const row = db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.id, id))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    redirectUris: JSON.parse(row.redirectUris) as string[],
    createdAt: row.createdAt,
  };
}

/** Constant-time comparison of two secrets of any length. */
export function secretsMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Returns the plaintext code, to be sent to the client's redirect URI. */
export function issueAuthCode(
  db: Db,
  input: { clientId: string; redirectUri: string; codeChallenge: string },
): string {
  const code = secret(CODE_PREFIX);
  db.insert(oauthAuthCodes)
    .values({
      codeHash: hashToken(code),
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      expiresAt: inMs(AUTH_CODE_TTL_MS),
      createdAt: nowIso(),
    })
    .run();
  return code;
}

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
};

function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return secretsMatch(computed, challenge);
}

/** Replaces the grant's access token with a fresh one and mints a refresh token. */
function rotate(
  db: DbHandle,
  tokenId: string,
  clientId: string,
): TokenResponse {
  const accessToken = secret(TOKEN_PREFIX);
  const refreshToken = secret(REFRESH_PREFIX);
  db.update(tokens)
    .set({
      tokenHash: hashToken(accessToken),
      expiresAt: inMs(ACCESS_TOKEN_TTL_S * 1000),
    })
    .where(eq(tokens.id, tokenId))
    .run();
  db.insert(oauthRefreshTokens)
    .values({
      tokenHash: hashToken(refreshToken),
      clientId,
      tokenId,
      expiresAt: inMs(REFRESH_TOKEN_TTL_MS),
      createdAt: nowIso(),
    })
    .run();
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: refreshToken,
  };
}

function revokeGrant(db: DbHandle, tokenId: string): void {
  db.update(tokens)
    .set({ revokedAt: nowIso() })
    .where(and(eq(tokens.id, tokenId), isNull(tokens.revokedAt)))
    .run();
}

type Outcome = { response: TokenResponse } | { replayOf: string | null };

const invalidGrant = (why: string) => new OAuthError("invalid_grant", why);

/**
 * Exchanges an authorization code. One `tokens` row (actor `agent`) represents
 * the whole grant: refreshing rotates its hash in place, so `token list` shows
 * one entry per connected client and `token revoke` ends the grant for good.
 */
export function exchangeAuthCode(
  db: Db,
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  },
): TokenResponse {
  const outcome: Outcome = db.transaction((tx): Outcome => {
    const row = tx
      .select()
      .from(oauthAuthCodes)
      .where(eq(oauthAuthCodes.codeHash, hashToken(input.code)))
      .get();
    if (!row || row.clientId !== input.clientId) {
      throw invalidGrant("Unknown authorization code");
    }
    if (row.usedAt) return { replayOf: row.tokenId };
    // A failed attempt does not burn the code, but an expired one is dead.
    if (row.expiresAt <= nowIso())
      throw invalidGrant("Authorization code expired");
    if (row.redirectUri !== input.redirectUri) {
      throw invalidGrant(
        "redirect_uri does not match the authorization request",
      );
    }
    if (!pkceMatches(input.codeVerifier, row.codeChallenge)) {
      throw invalidGrant("PKCE verification failed");
    }

    const client = findClient(tx, row.clientId);
    const tokenId = newId();
    const createdAt = nowIso();
    tx.insert(tokens)
      .values({
        id: tokenId,
        name: `oauth: ${client?.name ?? row.clientId}`,
        actor: "agent",
        tokenHash: hashToken(secret(TOKEN_PREFIX)), // placeholder, replaced below
        scopes: "all",
        createdAt,
      })
      .run();
    const response = rotate(tx, tokenId, row.clientId);
    tx.update(oauthAuthCodes)
      .set({ usedAt: createdAt, tokenId })
      .where(eq(oauthAuthCodes.codeHash, row.codeHash))
      .run();
    return { response };
  });
  if ("response" in outcome) return outcome.response;
  // Replay: whatever the first exchange issued is now suspect. Revoked outside
  // the transaction, because throwing inside it would roll the revocation back.
  if (outcome.replayOf) revokeGrant(db, outcome.replayOf);
  throw invalidGrant("Authorization code already used");
}

/** Rotating refresh: the presented token is spent; replaying it kills the grant. */
export function refreshGrant(
  db: Db,
  input: { refreshToken: string; clientId: string },
): TokenResponse {
  const outcome: Outcome = db.transaction((tx): Outcome => {
    const row = tx
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, hashToken(input.refreshToken)))
      .get();
    if (!row || row.clientId !== input.clientId) {
      throw invalidGrant("Unknown refresh token");
    }
    if (row.usedAt) return { replayOf: row.tokenId };
    if (row.expiresAt <= nowIso()) throw invalidGrant("Refresh token expired");
    const grant = tx
      .select()
      .from(tokens)
      .where(eq(tokens.id, row.tokenId))
      .get();
    if (!grant || grant.revokedAt) throw invalidGrant("Grant has been revoked");

    tx.update(oauthRefreshTokens)
      .set({ usedAt: nowIso() })
      .where(eq(oauthRefreshTokens.tokenHash, row.tokenHash))
      .run();
    return { response: rotate(tx, row.tokenId, row.clientId) };
  });
  if ("response" in outcome) return outcome.response;
  if (outcome.replayOf) revokeGrant(db, outcome.replayOf);
  throw invalidGrant("Refresh token already used");
}
