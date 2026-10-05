#!/usr/bin/env tsx
import { fileURLToPath } from "node:url";
import { ConfigError, loadConfig, loadConfigFromEnv } from "../config.js";
import { type Db, openDatabase } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { runTokenCommand, tokenHelp, UsageError } from "./token.js";

type Env = Record<string, string | undefined>;

const USAGE = `Usage:
  tracker db migrate
  tracker token create --name <name> --actor agent|you
  tracker token list
  tracker token revoke <id>`;

/** Runs a `tracker` CLI command and returns the process exit code. */
export async function runCli(
  argv: string[],
  env?: Env,
  logError: (message: string) => void = console.error,
  out: (message: string) => void = console.log,
): Promise<number> {
  const [group, command] = argv;
  try {
    if (group === "--help" || group === "help") {
      out(USAGE);
      return 0;
    }
    // Help never needs configuration or a database.
    if (group === "db" && argv.some((a) => a === "--help" || a === "-h")) {
      out("Usage: tracker db migrate\n\nApplies pending database migrations.");
      return 0;
    }
    const help = group === "token" ? tokenHelp(argv.slice(1)) : null;
    if (help) {
      out(help);
      return 0;
    }
    if (group === "db" && command === "migrate") {
      withDb(env, (db) => runMigrations(db));
      out("migrations up to date");
      return 0;
    }
    if (group === "token") {
      withDb(env, (db) => runTokenCommand(db, argv.slice(1), out));
      return 0;
    }
    logError(`Unknown command: ${argv.join(" ") || "(none)"}\n${USAGE}`);
    return 1;
  } catch (err) {
    if (err instanceof UsageError) logError(err.message);
    else logError(err instanceof ConfigError ? err.message : errorMessage(err));
    return 1;
  }
}

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

function withDb(env: Env | undefined, fn: (db: Db) => void): void {
  const config = env ? loadConfig(env) : loadConfigFromEnv();
  const { sqlite, db } = openDatabase(config.dataDir);
  try {
    fn(db);
  } finally {
    sqlite.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await runCli(process.argv.slice(2)));
}
