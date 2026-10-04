import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { createTestDb } from "./helpers/test-db.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "tracker-db-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("openDatabase", () => {
  it("creates DATA_DIR and tracker.db, applying pragmas", () => {
    const dir = join(tempDir(), "nested", "data");
    const { sqlite } = openDatabase(dir);
    cleanups.push(() => sqlite.close());

    expect(existsSync(join(dir, "tracker.db"))).toBe(true);
    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(sqlite.pragma("synchronous", { simple: true })).toBe(1); // NORMAL
  });
});

describe("runMigrations", () => {
  it("is idempotent: a second run applies nothing new", () => {
    const { sqlite, db } = createTestDb({ migrate: false });
    cleanups.push(() => sqlite.close());

    runMigrations(db);
    const count = () =>
      sqlite
        .prepare("SELECT count(*) AS n FROM __drizzle_migrations")
        .get() as {
        n: number;
      };
    const first = count().n;
    runMigrations(db);
    expect(count().n).toBe(first);
    expect(first).toBeGreaterThan(0);
  });
});

describe("createTestDb", () => {
  it("returns a migrated in-memory database with foreign keys on", () => {
    const { sqlite } = createTestDb();
    cleanups.push(() => sqlite.close());
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    const row = sqlite
      .prepare("SELECT count(*) AS n FROM __drizzle_migrations")
      .get() as { n: number };
    expect(row.n).toBeGreaterThan(0);
  });
});
