import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

export type Sqlite = Database.Database;
export type Db = ReturnType<typeof createDb>;

/** Applies the pragmas the spec (6.1) requires on every connection. */
export function applyPragmas(sqlite: Sqlite): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
}

export function createDb(sqlite: Sqlite) {
  return drizzle(sqlite);
}

/**
 * Path of the database file inside a data directory. New installs use
 * `traccia.db`; a data directory that only has the pre-rename `tracker.db`
 * keeps using it, so an existing volume works untouched. Remove the fallback
 * one release after the rename.
 */
export function databasePath(dataDir: string): string {
  const current = join(dataDir, "traccia.db");
  const legacy = join(dataDir, "tracker.db");
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}

/** Opens the database in `dataDir` (see `databasePath`), creating the directory if needed. */
export function openDatabase(dataDir: string): { sqlite: Sqlite; db: Db } {
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(databasePath(dataDir));
  applyPragmas(sqlite);
  return { sqlite, db: createDb(sqlite) };
}
