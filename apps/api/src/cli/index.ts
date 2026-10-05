#!/usr/bin/env tsx
import { fileURLToPath } from "node:url";
import { ConfigError, loadConfig, loadConfigFromEnv } from "../config.js";
import { openDatabase } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";

type Env = Record<string, string | undefined>;

/** Runs a `tracker` CLI command and returns the process exit code. */
export async function runCli(
  argv: string[],
  env?: Env,
  logError: (message: string) => void = console.error,
): Promise<number> {
  const [group, command] = argv;
  try {
    if (group === "db" && command === "migrate") {
      const config = env ? loadConfig(env) : loadConfigFromEnv();
      const { sqlite, db } = openDatabase(config.dataDir);
      try {
        runMigrations(db);
      } finally {
        sqlite.close();
      }
      console.log("migrations up to date");
      return 0;
    }
    logError(
      `Unknown command: ${argv.join(" ") || "(none)"}\nUsage: tracker db migrate`,
    );
    return 1;
  } catch (err) {
    logError(err instanceof ConfigError ? err.message : String(err));
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await runCli(process.argv.slice(2)));
}
