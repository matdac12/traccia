import { afterEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/test-db.js";

const T = "2026-10-04T10:15:00.000Z";
const dbs: Array<() => void> = [];
afterEach(() => {
  while (dbs.length) dbs.pop()?.();
});

function setup() {
  const { sqlite } = createTestDb();
  dbs.push(() => sqlite.close());
  sqlite.prepare("INSERT INTO issue_keys (key) VALUES ('MAT')").run();
  sqlite
    .prepare(
      "INSERT INTO projects (id, key, name, created_by, created_at, updated_at) VALUES ('p1','MAT','P','you',?,?)",
    )
    .run(T, T);
  let n = 0;
  const insertIssue = (over: Record<string, unknown> = {}) => {
    n++;
    const row = {
      id: `i${n}`,
      project_id: "p1",
      key: "MAT",
      number: n,
      identifier: `MAT-${n}`,
      title: "t",
      created_by: "you",
      created_at: T,
      updated_at: T,
      ...over,
    };
    const cols = Object.keys(row);
    sqlite
      .prepare(
        `INSERT INTO issues (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      )
      .run(...Object.values(row));
    return row.id as string;
  };
  return { sqlite, insertIssue };
}

describe("baseline schema", () => {
  it("creates every table, the named indexes and the FTS table", () => {
    const { sqlite } = setup();
    const names = (type: string) =>
      (
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = ?")
          .all(type) as Array<{ name: string }>
      ).map((r) => r.name);
    expect(names("table")).toEqual(
      expect.arrayContaining([
        "issue_keys",
        "projects",
        "milestones",
        "issues",
        "labels",
        "issue_labels",
        "issue_relations",
        "comments",
        "attachments",
        "activity",
        "tokens",
        "search_index",
      ]),
    );
    expect(names("index")).toEqual(
      expect.arrayContaining([
        "issues_project_status",
        "issues_assignee",
        "issues_parent",
        "issues_milestone",
        "issues_updated",
        "comments_issue",
        "activity_issue",
        "labels_unique_name",
      ]),
    );
  });

  describe("CHECK constraints", () => {
    it.each(["", "A", "abc", "A-B", "ABCDEFGHI", "1AB"])(
      "rejects issue key %j",
      (key) => {
        const { sqlite } = setup();
        expect(() =>
          sqlite.prepare("INSERT INTO issue_keys (key) VALUES (?)").run(key),
        ).toThrow(/CHECK/);
      },
    );

    it.each(["AB", "A1", "ABCDEFGH", "M4T2"])("accepts issue key %j", (key) => {
      const { sqlite } = setup();
      sqlite.prepare("INSERT INTO issue_keys (key) VALUES (?)").run(key);
    });

    it("rejects a bad actor on every actor column", () => {
      const { sqlite, insertIssue } = setup();
      const issue = insertIssue();
      const bad = [
        () => insertIssue({ created_by: "bot" }),
        () => insertIssue({ assignee: "bot" }),
        () =>
          sqlite
            .prepare(
              "INSERT INTO projects (id,key,name,created_by,created_at,updated_at) VALUES ('x','MAT','n','bot',?,?)",
            )
            .run(T, T),
        () =>
          sqlite
            .prepare(
              "INSERT INTO milestones (id,project_id,name,created_by,created_at,updated_at) VALUES ('m','p1','n','bot',?,?)",
            )
            .run(T, T),
        () =>
          sqlite
            .prepare(
              "INSERT INTO comments (id,issue_id,body,actor,created_at,updated_at) VALUES ('c',?,'b','bot',?,?)",
            )
            .run(issue, T, T),
        () =>
          sqlite
            .prepare(
              "INSERT INTO attachments (id,issue_id,filename,mime_type,size_bytes,sha256,storage_key,actor,created_at) VALUES ('a',?,'f','m',1,'s','k','bot',?)",
            )
            .run(issue, T),
        () =>
          sqlite
            .prepare(
              "INSERT INTO activity (id,issue_id,actor,type,created_at) VALUES ('ac',?,'bot','issue_created',?)",
            )
            .run(issue, T),
        () =>
          sqlite
            .prepare(
              "INSERT INTO tokens (id,name,actor,token_hash,created_at) VALUES ('t','n','bot','h',?)",
            )
            .run(T),
      ];
      for (const run of bad) expect(run).toThrow(/CHECK/);
    });

    it("rejects an unknown issue status and accepts every valid one", () => {
      const { insertIssue } = setup();
      expect(() => insertIssue({ status: "open" })).toThrow(/CHECK/);
      for (const status of [
        "backlog",
        "todo",
        "in_progress",
        "in_review",
        "done",
        "canceled",
      ]) {
        insertIssue({ status });
      }
    });

    it("rejects an unknown project status", () => {
      const { sqlite } = setup();
      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO projects (id,key,name,status,created_by,created_at,updated_at) VALUES ('x','MAT','n','archived','you',?,?)",
          )
          .run(T, T),
      ).toThrow(/CHECK/);
    });

    it("rejects priority outside 0-4", () => {
      const { insertIssue } = setup();
      expect(() => insertIssue({ priority: -1 })).toThrow(/CHECK/);
      expect(() => insertIssue({ priority: 5 })).toThrow(/CHECK/);
      for (const priority of [0, 1, 2, 3, 4]) insertIssue({ priority });
    });

    it("rejects a negative estimate", () => {
      const { insertIssue } = setup();
      expect(() => insertIssue({ estimate: -1 })).toThrow(/CHECK/);
      insertIssue({ estimate: 0 });
    });

    it("rejects an issue relation where blocker equals blocked", () => {
      const { sqlite, insertIssue } = setup();
      const a = insertIssue();
      const b = insertIssue();
      const insert = sqlite.prepare(
        "INSERT INTO issue_relations (blocker_id, blocked_id, created_at) VALUES (?,?,?)",
      );
      expect(() => insert.run(a, a, T)).toThrow(/CHECK/);
      insert.run(a, b, T);
    });
  });

  describe("UNIQUE constraints and indexes", () => {
    it("enforces UNIQUE (key, number)", () => {
      const { insertIssue } = setup();
      insertIssue({ number: 7, identifier: "MAT-7" });
      expect(() => insertIssue({ number: 7, identifier: "MAT-7b" })).toThrow(
        /UNIQUE/,
      );
    });

    it("enforces a unique identifier", () => {
      const { insertIssue } = setup();
      insertIssue({ number: 1, identifier: "MAT-1" });
      expect(() => insertIssue({ number: 2, identifier: "MAT-1" })).toThrow(
        /UNIQUE/,
      );
    });

    it("enforces a unique token hash", () => {
      const { sqlite } = setup();
      const insert = sqlite.prepare(
        "INSERT INTO tokens (id,name,actor,token_hash,created_at) VALUES (?,?,?,?,?)",
      );
      insert.run("t1", "a", "agent", "h", T);
      expect(() => insert.run("t2", "b", "you", "h", T)).toThrow(/UNIQUE/);
    });

    it("keeps label names unique per project, case-insensitive, ignoring deleted", () => {
      const { sqlite } = setup();
      const insert = sqlite.prepare(
        "INSERT INTO labels (id,name,project_id,created_at) VALUES (?,?,?,?)",
      );
      insert.run("l1", "Bug", null, T);
      expect(() => insert.run("l2", "bug", null, T)).toThrow(/UNIQUE/);
      insert.run("l3", "bug", "p1", T); // same name, other scope
      sqlite.prepare("UPDATE labels SET deleted_at = ? WHERE id = 'l1'").run(T);
      insert.run("l4", "BUG", null, T); // old one is soft-deleted
    });
  });

  describe("foreign keys", () => {
    it("rejects rows pointing at missing parents", () => {
      const { sqlite, insertIssue } = setup();
      expect(() => insertIssue({ project_id: "nope" })).toThrow(/FOREIGN KEY/);
      expect(() => insertIssue({ key: "ZZ" })).toThrow(/FOREIGN KEY/);
      expect(() => insertIssue({ parent_id: "nope" })).toThrow(/FOREIGN KEY/);
      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO comments (id,issue_id,body,actor,created_at,updated_at) VALUES ('c','nope','b','you',?,?)",
          )
          .run(T, T),
      ).toThrow(/FOREIGN KEY/);
    });

    it("blocks deleting a referenced parent", () => {
      const { sqlite, insertIssue } = setup();
      insertIssue();
      expect(() => sqlite.prepare("DELETE FROM projects").run()).toThrow(
        /FOREIGN KEY/,
      );
    });
  });

  describe("search_index (FTS5)", () => {
    it("accepts a row and matches with stemming and diacritics folding", () => {
      const { sqlite } = setup();
      sqlite
        .prepare(
          "INSERT INTO search_index (kind, ref_id, issue_id, title, body) VALUES ('issue','i1','i1','Fix login','Users are running into città errors')",
        )
        .run();
      const match = (q: string) =>
        sqlite
          .prepare(
            "SELECT ref_id FROM search_index WHERE search_index MATCH ? ORDER BY bm25(search_index)",
          )
          .all(q);
      expect(match("run")).toEqual([{ ref_id: "i1" }]); // porter: running -> run
      expect(match("citta")).toEqual([{ ref_id: "i1" }]); // remove_diacritics
      expect(match("login")).toEqual([{ ref_id: "i1" }]);
      expect(match("missing")).toEqual([]);
    });
  });
});
