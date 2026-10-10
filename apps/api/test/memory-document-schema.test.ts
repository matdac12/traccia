import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { applyPragmas } from "../src/db/connection.js";
import { migrationsFolder } from "../src/db/migrate.js";
import { createTestDb } from "./helpers/test-db.js";

const T = "2026-10-10T10:00:00.000Z";
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function setup() {
  const { sqlite } = createTestDb();
  cleanups.push(() => sqlite.close());
  sqlite.prepare("INSERT INTO issue_keys (key) VALUES ('MAT')").run();
  sqlite
    .prepare(
      "INSERT INTO projects (id, key, name, created_by, created_at, updated_at) VALUES ('p1','MAT','P','you',?,?)",
    )
    .run(T, T);
  return sqlite;
}

const insertMemory = (
  sqlite: Database.Database,
  over: Record<string, unknown> = {},
) => {
  const row = {
    id: "m1",
    project_id: "p1",
    title: "t",
    created_by: "agent",
    created_at: T,
    updated_at: T,
    ...over,
  };
  const cols = Object.keys(row);
  sqlite
    .prepare(
      `INSERT INTO memories (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    )
    .run(...Object.values(row));
};

const insertDocument = (
  sqlite: Database.Database,
  over: Record<string, unknown> = {},
) => {
  const row = {
    id: "d1",
    project_id: "p1",
    filename: "a.md",
    mime_type: "text/markdown",
    size_bytes: 3,
    storage_key: "ab/abc",
    sha256: "abc",
    created_by: "you",
    created_at: T,
    updated_at: T,
    ...over,
  };
  const cols = Object.keys(row);
  sqlite
    .prepare(
      `INSERT INTO documents (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    )
    .run(...Object.values(row));
};

describe("memories table", () => {
  it("applies defaults and nullable soft-delete columns", () => {
    const sqlite = setup();
    insertMemory(sqlite);
    expect(sqlite.prepare("SELECT * FROM memories").get()).toMatchObject({
      body: "",
      tags: "[]",
      deleted_at: null,
      deleted_batch: null,
      deleted_by: null,
    });
  });

  it("rejects a bad actor and an unknown project", () => {
    const sqlite = setup();
    expect(() => insertMemory(sqlite, { created_by: "robot" })).toThrow(
      /CHECK/,
    );
    expect(() => insertMemory(sqlite, { project_id: "nope" })).toThrow(
      /FOREIGN KEY/,
    );
  });

  it("has a partial live-row index on project_id", () => {
    const sqlite = setup();
    const sql = sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'memories_project'")
      .get() as { sql: string };
    expect(sql.sql).toMatch(/WHERE .*deleted_at.* IS NULL/);
  });
});

describe("documents table", () => {
  it("applies defaults and nullable soft-delete columns", () => {
    const sqlite = setup();
    insertDocument(sqlite);
    expect(sqlite.prepare("SELECT * FROM documents").get()).toMatchObject({
      description: "",
      deleted_at: null,
      deleted_batch: null,
      deleted_by: null,
    });
  });

  it("rejects a bad actor and an unknown project", () => {
    const sqlite = setup();
    expect(() => insertDocument(sqlite, { created_by: "robot" })).toThrow(
      /CHECK/,
    );
    expect(() => insertDocument(sqlite, { project_id: "nope" })).toThrow(
      /FOREIGN KEY/,
    );
  });

  it("has a partial live-row index on project_id", () => {
    const sqlite = setup();
    const sql = sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'documents_project'")
      .get() as { sql: string };
    expect(sql.sql).toMatch(/WHERE .*deleted_at.* IS NULL/);
  });
});

describe("search_index", () => {
  it("accepts memory and document kinds", () => {
    const sqlite = setup();
    for (const kind of ["memory", "document"]) {
      sqlite
        .prepare(
          "INSERT INTO search_index (kind, ref_id, issue_id, title, body) VALUES (?, 'x', '', 'zebra', '')",
        )
        .run(kind);
    }
    const rows = sqlite
      .prepare("SELECT kind FROM search_index WHERE search_index MATCH 'zebra'")
      .all();
    expect(rows).toHaveLength(2);
  });
});

describe("migration 0004 on an existing database", () => {
  it("adds the tables without disturbing data migrated up to 0003", () => {
    const dir = mkdtempSync(join(tmpdir(), "traccia-mig-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    cpSync(migrationsFolder, dir, { recursive: true });
    const journalPath = join(dir, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 4);
    writeFileSync(journalPath, JSON.stringify(journal));

    const sqlite = new Database(":memory:");
    cleanups.push(() => sqlite.close());
    applyPragmas(sqlite);
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: dir });
    expect(
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('memories','documents')",
        )
        .all(),
    ).toEqual([]);
    sqlite.prepare("INSERT INTO issue_keys (key) VALUES ('MAT')").run();
    sqlite
      .prepare(
        "INSERT INTO projects (id, key, name, created_by, created_at, updated_at) VALUES ('p1','MAT','P','you',?,?)",
      )
      .run(T, T);

    migrate(db, { migrationsFolder });
    expect(
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('memories','documents') ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: "documents" }, { name: "memories" }]);
    expect(sqlite.prepare("SELECT id FROM projects").all()).toEqual([
      { id: "p1" },
    ]);
  });
});
