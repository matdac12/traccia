import Database from "better-sqlite3";
import { applyPragmas, createDb } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";

/**
 * Test helper for every service test: a fresh in-memory SQLite database with
 * the same pragmas as production and all migrations applied. Each call returns
 * an isolated database; close `sqlite` when done (or let it be garbage
 * collected). Pass `{ migrate: false }` to get an empty database.
 */
export function createTestDb(options: { migrate?: boolean } = {}) {
  const sqlite = new Database(":memory:");
  applyPragmas(sqlite);
  const db = createDb(sqlite);
  if (options.migrate !== false) runMigrations(db);
  return { sqlite, db };
}
