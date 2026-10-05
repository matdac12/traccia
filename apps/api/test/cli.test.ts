import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli/index.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length)
    rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function env() {
  const dir = mkdtempSync(join(tmpdir(), "tracker-cli-"));
  dirs.push(dir);
  return { DATA_DIR: dir, BASE_URL: "http://localhost:8787" };
}

function migrationCount(dataDir: string) {
  const sqlite = new Database(join(dataDir, "tracker.db"));
  const row = sqlite
    .prepare("SELECT count(*) AS n FROM __drizzle_migrations")
    .get() as { n: number };
  sqlite.close();
  return row.n;
}

describe("tracker db migrate", () => {
  it("is idempotent: running twice leaves the same applied migrations", async () => {
    const e = env();
    expect(await runCli(["db", "migrate"], e)).toBe(0);
    const first = migrationCount(e.DATA_DIR);
    expect(await runCli(["db", "migrate"], e)).toBe(0);
    expect(migrationCount(e.DATA_DIR)).toBe(first);
  });

  it("fails with a message naming the bad variable", async () => {
    const e = { ...env(), BASE_URL: "" };
    const errors: string[] = [];
    const code = await runCli(["db", "migrate"], e, (m) => errors.push(m));
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/BASE_URL/);
  });

  it("rejects unknown commands", async () => {
    expect(await runCli(["nope"], env(), () => {})).toBe(1);
  });
});
