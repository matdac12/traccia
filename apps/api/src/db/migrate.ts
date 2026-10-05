import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./connection.js";

export const migrationsFolder = fileURLToPath(
  new URL("./migrations", import.meta.url),
);

/** Applies pending SQL migrations. Already-applied ones are skipped. */
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder });
}
