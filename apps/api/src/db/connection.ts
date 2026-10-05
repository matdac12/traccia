import { mkdirSync } from "node:fs";
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

/** Path of the database file inside a data directory. */
export const databasePath = (dataDir: string) => join(dataDir, "tracker.db");

/** Opens `${dataDir}/tracker.db`, creating the directory if needed. */
export function openDatabase(dataDir: string): { sqlite: Sqlite; db: Db } {
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(databasePath(dataDir));
  applyPragmas(sqlite);
  return { sqlite, db: createDb(sqlite) };
}
