import { createHash, randomBytes } from "node:crypto";
import type { Actor } from "@linear-matti/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db/connection.js";
import { tokens } from "../db/schema.js";
import { newId } from "../ids.js";
import { nowIso } from "../time.js";
import { NotFoundError, ValidationError } from "./errors.js";

export const TOKEN_PREFIX = "trk_";

export type TokenSummary = {
  id: string;
  name: string;
  actor: Actor;
  scopes: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

/** What `createToken` returns; `token` is the plaintext, shown exactly once. */
export type CreatedToken = TokenSummary & { token: string };

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const summary = {
  id: tokens.id,
  name: tokens.name,
  actor: tokens.actor,
  scopes: tokens.scopes,
  createdAt: tokens.createdAt,
  lastUsedAt: tokens.lastUsedAt,
  revokedAt: tokens.revokedAt,
};

export function createToken(
  db: Db,
  input: { name: string; actor: Actor },
): CreatedToken {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Token name must not be empty");
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const row = {
    id: newId(),
    name,
    actor: input.actor,
    tokenHash: hashToken(token),
    scopes: "all", // reserved
    createdAt: nowIso(),
  };
  db.insert(tokens).values(row).run();
  return {
    id: row.id,
    name,
    actor: row.actor,
    scopes: row.scopes,
    createdAt: row.createdAt,
    lastUsedAt: null,
    revokedAt: null,
    token,
  };
}

/** Never includes hashes. */
export function listTokens(db: Db): TokenSummary[] {
  return db
    .select(summary)
    .from(tokens)
    .orderBy(tokens.createdAt, tokens.id)
    .all();
}

/** Idempotent: revoking a revoked token keeps its original `revoked_at`. */
export function revokeToken(db: Db, id: string): TokenSummary {
  const existing = db
    .select(summary)
    .from(tokens)
    .where(eq(tokens.id, id))
    .get();
  if (!existing) throw new NotFoundError(`Token ${id} not found`);
  if (existing.revokedAt) return existing;
  const revokedAt = nowIso();
  db.update(tokens).set({ revokedAt }).where(eq(tokens.id, id)).run();
  return { ...existing, revokedAt };
}
