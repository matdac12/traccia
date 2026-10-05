#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ConfigError, loadConfig, loadConfigFromEnv } from "../config.js";
import { type Db, databasePath, openDatabase } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { SnapshotError, takeSnapshot } from "../db/snapshot.js";
import { rebuildSearchIndex } from "../service/search-index.js";
import { runTokenCommand, tokenHelp, UsageError } from "./token.js";

type Env = Record<string, string | undefined>;

const DB_USAGE = `Usage:
  traccia db migrate
  traccia db reindex
  traccia db snapshot [--out <dir>] [--keep <n>]

migrate   Applies pending database migrations.
reindex   Rebuilds the full-text search index from the issues and comments
          tables (soft-deleted rows excluded). Idempotent.
snapshot  Writes a consistent online snapshot traccia-<UTC timestamp>.db to
          --out (default: $DATA_DIR/backups), runs PRAGMA integrity_check on it,
          and deletes all but the newest --keep (default 3) snapshots there.
          Safe to run while the API is serving writes.`;

const USAGE = `Usage:
  traccia db migrate
  traccia db reindex
  traccia db snapshot [--out <dir>] [--keep <n>]
  traccia token create --name <name> --actor agent|you
  traccia token list
  traccia token revoke <id>`;

/** Runs a `traccia` CLI command and returns the process exit code. */
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
      out(DB_USAGE);
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
    if (group === "db" && command === "reindex") {
      withDb(env, (db) => {
        const n = db.transaction((tx) => rebuildSearchIndex(tx), {
          behavior: "immediate",
        });
        out(`search index rebuilt: ${n.issues} issues, ${n.comments} comments`);
      });
      return 0;
    }
    if (group === "db" && command === "snapshot") {
      runSnapshot(argv.slice(2), env, out);
      return 0;
    }
    if (group === "token") {
      withDb(env, (db) => runTokenCommand(db, argv.slice(1), out));
      return 0;
    }
    logError(`Unknown command: ${argv.join(" ") || "(none)"}\n${USAGE}`);
    return 1;
  } catch (err) {
    if (err instanceof UsageError || err instanceof SnapshotError)
      logError(err.message);
    else logError(err instanceof ConfigError ? err.message : errorMessage(err));
    return 1;
  }
}

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

function runSnapshot(
  args: string[],
  env: Env | undefined,
  out: (message: string) => void,
): void {
  let values: { out?: string; keep?: string };
  try {
    const parsed = parseArgs({
      args,
      options: { out: { type: "string" }, keep: { type: "string" } },
    });
    values = parsed.values;
  } catch (err) {
    throw new UsageError(errorMessage(err));
  }
  // takeSnapshot validates --keep, so a bad value fails there with a clear error.
  const keep = values.keep === undefined ? 3 : Number(values.keep);
  const config = env ? loadConfig(env) : loadConfigFromEnv();
  // Never create an empty database just to snapshot it.
  if (!existsSync(databasePath(config.dataDir))) {
    throw new SnapshotError(`No database at ${databasePath(config.dataDir)}`);
  }
  const { sqlite } = openDatabase(config.dataDir);
  try {
    const result = takeSnapshot(sqlite, {
      outDir: values.out ?? join(config.dataDir, "backups"),
      keep,
    });
    out(`Snapshot written: ${result.path} (integrity_check ok)`);
    if (result.removed.length) {
      out(`Removed old snapshots: ${result.removed.join(", ")}`);
    }
  } finally {
    sqlite.close();
  }
}

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
