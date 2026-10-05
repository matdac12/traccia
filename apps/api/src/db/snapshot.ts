import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import type { Sqlite } from "./connection.js";

/** Matches `traccia-<UTC>.db` and the pre-rename `tracker-<UTC>.db`, so retention still prunes old snapshots. */
export const SNAPSHOT_PATTERN = /^(?:traccia|tracker)-\d{8}T\d{6}Z\.db$/;

export class SnapshotError extends Error {
  override name = "SnapshotError";
}

export type SnapshotResult = {
  path: string;
  /** Snapshot file names removed by retention, oldest first. */
  removed: string[];
};

/** `traccia-20261005T083000Z.db`: sorts lexically in time order. */
export function snapshotName(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `traccia-${stamp}Z.db`;
}

function prepareDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    accessSync(dir, constants.W_OK);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new SnapshotError(
      `Cannot write snapshots to ${dir}: ${reason}. Pass --out <dir> with a writable directory.`,
    );
  }
}

/**
 * Writes a consistent copy of the open database to `outDir` and keeps only the
 * newest `keep` snapshots there.
 *
 * Uses `VACUUM INTO`, which reads one consistent view of the WAL database in a
 * single read transaction, so concurrent writers neither block it nor leak a
 * half-written state into the copy. The live file is never copied directly.
 * The copy is written under a temporary name, integrity-checked, and only then
 * renamed into place, so a failed run leaves no snapshot behind and never
 * counts against retention.
 */
export function takeSnapshot(
  sqlite: Sqlite,
  options: { outDir: string; keep: number; now?: Date },
): SnapshotResult {
  const { keep } = options;
  if (!Number.isInteger(keep) || keep < 1) {
    throw new SnapshotError("--keep must be a positive integer");
  }
  const outDir = resolve(options.outDir);
  prepareDir(outDir);

  const name = snapshotName(options.now ?? new Date());
  const finalPath = join(outDir, name);
  const partialPath = join(outDir, `.${name}.partial`);
  if (existsSync(finalPath)) {
    throw new SnapshotError(
      `${finalPath} already exists; try again in a second.`,
    );
  }
  rmSync(partialPath, { force: true });

  try {
    sqlite.prepare("VACUUM INTO ?").run(partialPath);
    chmodSync(partialPath, 0o600);
    verify(partialPath);
    renameSync(partialPath, finalPath);
  } catch (err) {
    rmSync(partialPath, { force: true });
    if (err instanceof SnapshotError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new SnapshotError(`Snapshot failed: ${reason}`);
  }

  return { path: finalPath, removed: applyRetention(outDir, keep) };
}

function verify(path: string): void {
  const copy = new Database(path, { readonly: true });
  try {
    const rows = copy.pragma("integrity_check") as {
      integrity_check: string;
    }[];
    const problems = rows
      .map((r) => r.integrity_check)
      .filter((m) => m !== "ok");
    if (problems.length) {
      throw new SnapshotError(
        `integrity_check failed on the snapshot: ${problems.slice(0, 5).join("; ")}`,
      );
    }
  } finally {
    copy.close();
  }
}

const stamp = (file: string) => file.slice(file.indexOf("-") + 1);

function applyRetention(dir: string, keep: number): string[] {
  const snapshots = readdirSync(dir)
    .filter((f) => SNAPSHOT_PATTERN.test(f))
    // Sort by timestamp: the two prefixes would otherwise order by name, not age.
    .sort((a, b) => stamp(a).localeCompare(stamp(b)));
  const stale = snapshots.slice(0, Math.max(0, snapshots.length - keep));
  for (const f of stale) rmSync(join(dir, f), { force: true });
  return stale;
}
