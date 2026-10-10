import { eq, inArray, sql } from "drizzle-orm";
import { comments, documents, issues, memories } from "../db/schema.js";
import type { Comment } from "./comments.js";
import type { DbHandle } from "./context.js";
import type { Issue } from "./issues.js";

/**
 * Keeps the hand-written FTS5 `search_index` table (ADR 0005) in sync. Every
 * function takes the caller's open transaction, so the index commits or rolls
 * back with the write that changed it. Rows are `kind` = `issue` | `comment`;
 * comments carry the owning `issue_id` and an empty title. `memory` rows hold
 * title + body, `document` rows filename (as title) + description (as body);
 * both have an empty `issue_id`, so issue search never surfaces them.
 *
 * Soft delete / restore / purge (TRC-27) call `removeFromSearchIndex` and
 * `reindexIssues` from the same transaction as the `deleted_at` change.
 */

/** Adds or replaces the row of one issue. */
export function indexIssue(
  tx: DbHandle,
  issue: Pick<Issue, "id" | "title" | "description">,
): void {
  removeFromSearchIndex(tx, { refIds: [issue.id] });
  tx.run(
    sql`INSERT INTO search_index (kind, ref_id, issue_id, title, body)
        VALUES ('issue', ${issue.id}, ${issue.id}, ${issue.title}, ${issue.description})`,
  );
}

/** Adds or replaces the row of one comment. */
export function indexComment(
  tx: DbHandle,
  comment: Pick<Comment, "id" | "issueId" | "body">,
): void {
  removeFromSearchIndex(tx, { refIds: [comment.id] });
  tx.run(
    sql`INSERT INTO search_index (kind, ref_id, issue_id, title, body)
        VALUES ('comment', ${comment.id}, ${comment.issueId}, '', ${comment.body})`,
  );
}

/** Adds or replaces the row of one memory (title + body). */
export function indexMemory(
  tx: DbHandle,
  memory: Pick<typeof memories.$inferSelect, "id" | "title" | "body">,
): void {
  removeFromSearchIndex(tx, { refIds: [memory.id] });
  tx.run(
    sql`INSERT INTO search_index (kind, ref_id, issue_id, title, body)
        VALUES ('memory', ${memory.id}, '', ${memory.title}, ${memory.body})`,
  );
}

/** Adds or replaces the row of one document (filename + description). */
export function indexDocument(
  tx: DbHandle,
  document: Pick<
    typeof documents.$inferSelect,
    "id" | "filename" | "description"
  >,
): void {
  removeFromSearchIndex(tx, { refIds: [document.id] });
  tx.run(
    sql`INSERT INTO search_index (kind, ref_id, issue_id, title, body)
        VALUES ('document', ${document.id}, '', ${document.filename}, ${document.description})`,
  );
}

const CHUNK = 500;
function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    out.push(items.slice(i, i + CHUNK));
  }
  return out;
}

/**
 * Deletes index rows by their own id (`refIds`: issue or comment ids) and/or
 * every row belonging to the given issues (`issueIds`: the issue plus all of
 * its comments). Use for soft delete and purge.
 */
export function removeFromSearchIndex(
  tx: DbHandle,
  target: { refIds?: string[]; issueIds?: string[] },
): void {
  for (const ids of chunks(target.refIds ?? [])) {
    tx.run(
      sql`DELETE FROM search_index WHERE ref_id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }
  for (const ids of chunks(target.issueIds ?? [])) {
    tx.run(
      sql`DELETE FROM search_index WHERE issue_id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }
}

/**
 * (Re-)adds the given issues and their non-deleted comments, replacing any
 * existing rows. Idempotent; issues that are missing or soft-deleted are
 * skipped. Use for restore.
 */
export function reindexIssues(tx: DbHandle, issueIds: string[]): void {
  for (const ids of chunks(issueIds)) {
    removeFromSearchIndex(tx, { issueIds: ids });
    for (const issue of tx
      .select()
      .from(issues)
      .where(inArray(issues.id, ids))
      .all()) {
      if (issue.deletedAt !== null) continue;
      indexIssue(tx, issue);
      for (const c of tx
        .select()
        .from(comments)
        .where(eq(comments.issueId, issue.id))
        .all()) {
        if (c.deletedAt === null) indexComment(tx, c);
      }
    }
  }
}

/**
 * (Re-)adds the given memories and documents unless soft-deleted. Idempotent;
 * use for restore.
 */
export function reindexKnowledge(
  tx: DbHandle,
  target: { memoryIds?: string[]; documentIds?: string[] },
): void {
  for (const ids of chunks(target.memoryIds ?? [])) {
    for (const m of tx
      .select()
      .from(memories)
      .where(inArray(memories.id, ids))
      .all()) {
      if (m.deletedAt === null) indexMemory(tx, m);
    }
  }
  for (const ids of chunks(target.documentIds ?? [])) {
    for (const d of tx
      .select()
      .from(documents)
      .where(inArray(documents.id, ids))
      .all()) {
      if (d.deletedAt === null) indexDocument(tx, d);
    }
  }
}

/** Rebuilds the whole index from the source tables, excluding soft-deleted rows. */
export function rebuildSearchIndex(tx: DbHandle): {
  issues: number;
  comments: number;
  memories: number;
  documents: number;
} {
  tx.run(sql`DELETE FROM search_index`);
  tx.run(
    sql`INSERT INTO search_index (kind, ref_id, issue_id, title, body)
        SELECT 'issue', id, id, title, description FROM issues WHERE deleted_at IS NULL`,
  );
  tx.run(
    sql`INSERT INTO search_index (kind, ref_id, issue_id, title, body)
        SELECT 'comment', c.id, c.issue_id, '', c.body
        FROM comments c JOIN issues i ON i.id = c.issue_id
        WHERE c.deleted_at IS NULL AND i.deleted_at IS NULL`,
  );
  tx.run(
    sql`INSERT INTO search_index (kind, ref_id, issue_id, title, body)
        SELECT 'memory', m.id, '', m.title, m.body
        FROM memories m JOIN projects p ON p.id = m.project_id
        WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL`,
  );
  tx.run(
    sql`INSERT INTO search_index (kind, ref_id, issue_id, title, body)
        SELECT 'document', d.id, '', d.filename, d.description
        FROM documents d JOIN projects p ON p.id = d.project_id
        WHERE d.deleted_at IS NULL AND p.deleted_at IS NULL`,
  );
  const count = (kind: string) =>
    tx.get<{ n: number }>(
      sql`SELECT count(*) AS n FROM search_index WHERE kind = ${kind}`,
    )?.n ?? 0;
  return {
    issues: count("issue"),
    comments: count("comment"),
    memories: count("memory"),
    documents: count("document"),
  };
}
