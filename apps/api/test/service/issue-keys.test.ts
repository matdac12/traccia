import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { ServiceError } from "@linear-matti/shared";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyPragmas, createDb } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createServiceContext } from "../../src/service/context.js";
import { allocateIssueNumber } from "../../src/service/index.js";
import { onCleanup, setupServices } from "./helpers.js";

const nextNumber = (sqlite: Database.Database, key: string) =>
  (
    sqlite
      .prepare("SELECT next_number AS n FROM issue_keys WHERE key = ?")
      .get(key) as { n: number }
  ).n;

describe("issue key allocation", () => {
  it("creates the key row on first use, starting at 1", () => {
    const { db } = setupServices();
    const ctx = createServiceContext({ db, defaultIssueKey: "MAT" });
    expect(ctx.write((tx) => allocateIssueNumber(tx, "MAT"))).toBe(1);
    expect(ctx.write((tx) => allocateIssueNumber(tx, "MAT"))).toBe(2);
  });

  it("keeps counters independent per key", () => {
    const { db } = setupServices();
    const ctx = createServiceContext({ db, defaultIssueKey: "MAT" });
    ctx.write((tx) => allocateIssueNumber(tx, "MAT"));
    expect(ctx.write((tx) => allocateIssueNumber(tx, "OPS"))).toBe(1);
    expect(ctx.write((tx) => allocateIssueNumber(tx, "MAT"))).toBe(2);
  });

  it("rolls the counter back with the surrounding transaction", () => {
    const { db } = setupServices();
    const ctx = createServiceContext({ db, defaultIssueKey: "MAT" });
    expect(() =>
      ctx.write((tx) => {
        allocateIssueNumber(tx, "MAT");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(ctx.write((tx) => allocateIssueNumber(tx, "MAT"))).toBe(1);
  });

  it("never reuses numbers after the numbered rows are deleted", () => {
    const { db, sqlite } = setupServices();
    const ctx = createServiceContext({ db, defaultIssueKey: "MAT" });
    ctx.write((tx) => allocateIssueNumber(tx, "MAT"));
    ctx.write((tx) => allocateIssueNumber(tx, "MAT"));
    sqlite.prepare("DELETE FROM issues").run();
    expect(ctx.write((tx) => allocateIssueNumber(tx, "MAT"))).toBe(3);
  });

  it("rejects a malformed key with validation_error; the DB CHECK backs it up", () => {
    const { db, sqlite } = setupServices();
    const ctx = createServiceContext({ db, defaultIssueKey: "MAT" });
    for (const bad of ["mat", "M", "TOOLONGKEY", "1AB", "A-B", ""]) {
      expect(() => ctx.write((tx) => allocateIssueNumber(tx, bad))).toThrow(
        ServiceError,
      );
    }
    expect(() =>
      sqlite.prepare("INSERT INTO issue_keys (key) VALUES ('mat')").run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it("interleaved transactions from two connections get unique numbers", () => {
    const dir = mkdtempSync(join(tmpdir(), "tracker-keys-"));
    onCleanup(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "t.db");
    const open = () => {
      const sqlite = new Database(path);
      applyPragmas(sqlite);
      onCleanup(() => sqlite.close());
      const db = createDb(sqlite);
      return createServiceContext({ db, defaultIssueKey: "MAT" });
    };
    const a = open();
    runMigrations(a.db);
    const b = open();

    const seen: number[] = [];
    for (let i = 0; i < 10; i++) {
      seen.push(a.write((tx) => allocateIssueNumber(tx, "MAT")));
      seen.push(b.write((tx) => allocateIssueNumber(tx, "MAT")));
    }
    expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("concurrent writers racing in separate threads never collide", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tracker-race-"));
    onCleanup(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "t.db");
    const seed = new Database(path);
    applyPragmas(seed);
    runMigrations(createDb(seed));
    seed.close();

    const workers = 4;
    const perWorker = 50;
    const results = await Promise.all(
      Array.from({ length: workers }, () => runWorker(path, perWorker)),
    );

    const all = results.flat().sort((x, y) => x - y);
    expect(all).toEqual(
      Array.from({ length: workers * perWorker }, (_, i) => i + 1),
    );
    const check = new Database(path);
    onCleanup(() => check.close());
    expect(nextNumber(check, "MAT")).toBe(workers * perWorker + 1);
  });
});

// Plain JS so the worker needs no TypeScript loader. It runs the same
// statement as `allocateIssueNumber` on its own connection, inside the same
// kind of IMMEDIATE transaction `ServiceContext.write` opens.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const Database = require("better-sqlite3");
const db = new Database(workerData.path);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.prepare("INSERT OR IGNORE INTO issue_keys (key) VALUES ('MAT')").run();
const alloc = db.transaction(() =>
  db.prepare("UPDATE issue_keys SET next_number = next_number + 1 WHERE key = 'MAT' RETURNING next_number - 1 AS n").get().n,
);
const out = [];
for (let i = 0; i < workerData.count; i++) out.push(alloc.immediate());
parentPort.postMessage(out);
`;

function runWorker(path: string, count: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { path, count },
    });
    worker.once("message", resolve);
    worker.once("error", reject);
  });
}
