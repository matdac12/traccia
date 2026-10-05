import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokens } from "../src/db/schema.js";
import { NotFoundError } from "../src/service/errors.js";
import { createToken, listTokens, revokeToken } from "../src/service/tokens.js";
import { createTestDb } from "./helpers/test-db.js";

describe("token service", () => {
  it("creates a trk_ token with 32 random bytes of base64url", () => {
    const { db } = createTestDb();
    const created = createToken(db, { name: "laptop", actor: "agent" });
    expect(created.token).toMatch(/^trk_[A-Za-z0-9_-]{43}$/);
    expect(created).toMatchObject({ name: "laptop", actor: "agent" });
  });

  it("stores only the SHA-256 hash, never the plaintext", () => {
    const { db, sqlite } = createTestDb();
    const { token, id } = createToken(db, { name: "laptop", actor: "you" });
    const rows = db.select().from(tokens).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
    expect(rows[0]?.tokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(rows[0]?.scopes).toBe("all");
    const dump = JSON.stringify(sqlite.prepare("SELECT * FROM tokens").all());
    expect(dump).not.toContain(token);
  });

  it("generates a distinct token each time", () => {
    const { db } = createTestDb();
    const a = createToken(db, { name: "a", actor: "agent" });
    const b = createToken(db, { name: "b", actor: "agent" });
    expect(a.token).not.toBe(b.token);
  });

  it("rejects an empty name", () => {
    const { db } = createTestDb();
    expect(() => createToken(db, { name: "  ", actor: "agent" })).toThrow();
  });

  it("lists tokens without hashes or plaintext", () => {
    const { db } = createTestDb();
    const { token } = createToken(db, { name: "a", actor: "agent" });
    const list = listTokens(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: "a",
      actor: "agent",
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(Object.keys(list[0] ?? {})).not.toContain("tokenHash");
    expect(JSON.stringify(list)).not.toContain(token);
  });

  describe("revoke", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    });
    afterEach(() => vi.useRealTimers());

    it("sets revoked_at", () => {
      const { db } = createTestDb();
      const { id } = createToken(db, { name: "a", actor: "agent" });
      const revoked = revokeToken(db, id);
      expect(revoked.revokedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(listTokens(db)[0]?.revokedAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("keeps the original revoked_at when revoked twice", () => {
      const { db } = createTestDb();
      const { id } = createToken(db, { name: "a", actor: "agent" });
      revokeToken(db, id);
      vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
      expect(revokeToken(db, id).revokedAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("throws NotFoundError for an unknown id", () => {
      const { db } = createTestDb();
      expect(() => revokeToken(db, "nope")).toThrow(NotFoundError);
    });
  });
});
