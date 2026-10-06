import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { comments, issues } from "../../src/db/schema.js";
import {
  indexIssue,
  rebuildSearchIndex,
  reindexIssues,
  removeFromSearchIndex,
} from "../../src/service/search-index.js";
import { setupServices } from "./helpers.js";

function setup() {
  const s = setupServices();
  const project = s.services.projects.create("you", { name: "P" });
  const mk = (title: string, description = "") =>
    s.services.issues.create("agent", {
      project: project.id,
      title,
      description,
    });
  const find = (q: string) => s.services.search.search({ q });
  const ids = (q: string) => find(q).items.map((r) => r.identifier);
  const rows = () =>
    s.db.all<{ kind: string; ref_id: string }>(
      sql`SELECT kind, ref_id FROM search_index ORDER BY ref_id`,
    );
  return { ...s, project, mk, find, ids, rows };
}

describe("index sync", () => {
  it("indexes on create and re-indexes on title/description edit", () => {
    const { services, mk, ids } = setup();
    const a = mk("alpha", "first body");
    expect(ids("alpha")).toEqual([a.identifier]);
    services.issues.update("you", a.identifier, { title: "bravo" });
    expect(ids("alpha")).toEqual([]);
    expect(ids("bravo")).toEqual([a.identifier]);
    services.issues.update("you", a.identifier, { description: "zulu text" });
    expect(ids("first")).toEqual([]);
    expect(ids("zulu")).toEqual([a.identifier]);
  });

  it("indexes comments on create and edit, reporting the comment as source", () => {
    const { services, mk, find } = setup();
    const a = mk("alpha");
    const c = services.comments.create("you", a.identifier, {
      body: "needle here",
    });
    expect(find("needle").items[0]).toMatchObject({
      identifier: a.identifier,
      source: "comment",
    });
    services.comments.update("you", c.id, { body: "haystack" });
    expect(find("needle").items).toEqual([]);
    expect(find("haystack").items).toHaveLength(1);
  });

  it("removal hook drops issue and comment rows; reindex hook restores them", () => {
    const { services, db, mk, ids, rows } = setup();
    const a = mk("alpha");
    services.comments.create("you", a.identifier, { body: "needle" });
    expect(rows()).toHaveLength(2);
    removeFromSearchIndex(db, { issueIds: [a.id] });
    expect(rows()).toHaveLength(0);
    reindexIssues(db, [a.id]);
    expect(rows()).toHaveLength(2);
    reindexIssues(db, [a.id]); // idempotent
    expect(rows()).toHaveLength(2);
    expect(ids("needle")).toEqual([a.identifier]);
  });

  it("reindexIssues skips soft-deleted issues and comments; search hides deleted issues", () => {
    const { services, db, mk, ids, rows } = setup();
    const a = mk("alpha");
    const c = services.comments.create("you", a.identifier, { body: "needle" });
    db.update(comments)
      .set({ deletedAt: "2026-01-01T00:00:00.000Z" })
      .where(eq(comments.id, c.id))
      .run();
    reindexIssues(db, [a.id]);
    expect(rows()).toEqual([{ kind: "issue", ref_id: a.id }]);
    db.update(issues)
      .set({ deletedAt: "2026-01-01T00:00:00.000Z" })
      .where(eq(issues.id, a.id))
      .run();
    expect(ids("alpha")).toEqual([]); // stale row still filtered
    reindexIssues(db, [a.id]);
    expect(rows()).toEqual([]);
    indexIssue(db, a);
    expect(ids("alpha")).toEqual([]);
  });
});

describe("search", () => {
  it("finds accents without them and stems English", () => {
    const { mk, ids } = setup();
    const a = mk("Spiegare perché");
    const b = mk("task", "I was running tests");
    expect(ids("perche")).toEqual([a.identifier]);
    expect(ids("run")).toEqual([b.identifier]);
    expect(ids("running")).toEqual([b.identifier]);
  });

  it("matches a partial last word (prefix query)", () => {
    const { mk, ids } = setup();
    const a = mk("Spiegare perché");
    const b = mk("refactoring notes");
    expect(ids("perch")).toEqual([a.identifier]); // accented word, partial
    expect(ids("per")).toEqual([a.identifier]);
    expect(ids("refact")).toEqual([b.identifier]);
    expect(ids("refactoring")).toEqual([b.identifier]);
  });

  it("prefix-matches only the last token; earlier tokens must be whole", () => {
    const { mk, ids } = setup();
    const a = mk("alphabet soup");
    expect(ids("alph soup")).toEqual([]); // "alph" is not a whole earlier token
    expect(ids("alphabet sou")).toEqual([a.identifier]);
    expect(ids("alphabet soup")).toEqual([a.identifier]);
  });

  it("ranks a title match above a body-only match", () => {
    const { mk, ids } = setup();
    const body = mk("other", "deploy deploy deploy notes");
    const title = mk("deploy", "x");
    expect(ids("deploy")).toEqual([title.identifier, body.identifier]);
  });

  it("groups by issue with a safe, structured snippet", () => {
    const { services, mk, find } = setup();
    const a = mk("needle title", "needle body");
    services.comments.create("you", a.identifier, { body: "needle comment" });
    const r = find("needle");
    expect(r.items).toHaveLength(1);
    const snippet = r.items[0]?.snippet ?? [];
    expect(Array.isArray(snippet)).toBe(true);
    expect(snippet.some((s) => s.match && s.text === "needle")).toBe(true);
    expect(JSON.stringify(snippet)).not.toContain("<mark>");
  });

  it("never returns user HTML in a snippet, only plain-text segments", () => {
    const { mk, find } = setup();
    mk("safe", "before <script>needle</script> after");
    const [hit] = find("needle").items;
    const snippet = hit?.snippet ?? [];
    // The raw markup stays data, and only the hit is flagged.
    expect(snippet.map((s) => s.text).join("")).toContain("<script>");
    expect(snippet.some((s) => s.match && s.text === "needle")).toBe(true);
    expect(JSON.stringify(snippet)).not.toContain("<mark>");
  });

  it("filters by project", () => {
    const { services, mk } = setup();
    const other = services.projects.create("you", { name: "Q" });
    mk("shared word");
    services.issues.create("you", { project: other.id, title: "shared word" });
    expect(
      services.search.search({ q: "shared", project: other.id }).items,
    ).toHaveLength(1);
  });

  it("paginates with an opaque cursor", () => {
    const { services, mk } = setup();
    for (let i = 0; i < 3; i++) mk(`page ${i}`);
    const p1 = services.search.search({ q: "page", limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = services.search.search({
      q: "page",
      limit: 2,
      cursor: p1.nextCursor ?? undefined,
    });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
  });

  it.each([
    '"',
    "*",
    "AND",
    "OR NOT",
    "(",
    ")",
    "-",
    ":",
    'foo "bar',
    "a:b -c *",
    "   ",
    "",
    "perch*",
    "*perch",
    '"perch"*',
    "perch AND",
    "NEAR(perch)",
    "perch\u0000end",
  ])("never throws on hostile query %j", (q) => {
    const { mk, find, services } = setup();
    mk("foo bar AND baz");
    expect(() => find(q)).not.toThrow();
    expect(() => services.issues.list({ q })).not.toThrow();
  });

  it("treats operators as plain words and empty queries as empty results", () => {
    const { mk, ids, find } = setup();
    const a = mk("this AND that");
    expect(ids("AND")).toEqual([a.identifier]);
    expect(find("").items).toEqual([]);
    expect(find('"*').items).toEqual([]);
  });
});

describe("listIssues q", () => {
  it("combines q with other filters and ignores blank q", () => {
    const { services, mk } = setup();
    const a = mk("findme");
    const b = mk("findme too");
    services.issues.update("you", b.identifier, { status: "done" });
    mk("unrelated");
    expect(
      services.issues
        .list({ q: "findme" })
        .items.map((i) => i.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    expect(
      services.issues.list({ q: "findme", status: ["done"] }).items,
    ).toHaveLength(1);
    expect(services.issues.list({ q: "  " }).items).toHaveLength(3);
    expect(services.issues.list({ q: "!!!" }).items).toHaveLength(0);
  });
});

describe("rebuildSearchIndex", () => {
  it("restores correct results after index corruption and is idempotent", () => {
    const { services, db, mk, ids, rows } = setup();
    const a = mk("alpha");
    const dead = mk("ghost");
    services.comments.create("you", a.identifier, { body: "needle" });
    db.update(issues)
      .set({ deletedAt: "2026-01-01T00:00:00.000Z" })
      .where(eq(issues.id, dead.id))
      .run();
    db.run(sql`DELETE FROM search_index WHERE kind = 'comment'`);
    db.run(
      sql`INSERT INTO search_index (kind, ref_id, issue_id, title, body) VALUES ('issue', 'junk', 'junk', 'garbage', 'garbage')`,
    );
    expect(rebuildSearchIndex(db)).toEqual({ issues: 1, comments: 1 });
    const first = rows();
    expect(rebuildSearchIndex(db)).toEqual({ issues: 1, comments: 1 });
    expect(rows()).toEqual(first);
    expect(ids("garbage")).toEqual([]);
    expect(ids("ghost")).toEqual([]);
    expect(ids("needle")).toEqual([a.identifier]);
  });
});

describe("comment edit on a soft-deleted issue", () => {
  it("does not re-add the comment to the index", () => {
    const { services, db, mk, rows } = setup();
    const a = mk("alpha");
    const c = services.comments.create("you", a.identifier, { body: "old" });
    db.update(issues)
      .set({ deletedAt: "2026-01-01T00:00:00.000Z" })
      .where(eq(issues.id, a.id))
      .run();
    removeFromSearchIndex(db, { issueIds: [a.id] });
    services.comments.update("you", c.id, { body: "new" });
    expect(rows()).toEqual([]);
  });
});
