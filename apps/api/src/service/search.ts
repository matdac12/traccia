import { ServiceError } from "@linear-matti/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  decodeCursor,
  DEFAULT_LIMIT,
  encodeCursor,
  MAX_LIMIT,
  type Page,
} from "../rest/pagination.js";
import { type DbHandle, parseInput, type ServiceContext } from "./context.js";
import { resolveProject } from "./projects.js";

export const searchInputSchema = z.object({
  q: z.string(),
  /** Project id, name or key. */
  project: z.string().min(1).optional(),
  limit: z.number().int().min(1).optional(),
  cursor: z.string().min(1).optional(),
});
export type SearchInput = z.input<typeof searchInputSchema>;

export type SearchResult = {
  issueId: string;
  identifier: string;
  title: string;
  /** Where the best match was found. */
  source: "issue" | "comment";
  /**
   * The matching fragment, with hits wrapped in `<mark>…</mark>`. The rest is
   * raw issue/comment text, NOT HTML-escaped: escape it before rendering as HTML.
   */
  snippet: string;
};

/**
 * Turns free text into a safe FTS5 MATCH expression. Every run of letters or
 * digits becomes its own double-quoted token (implicitly AND-ed), so operators
 * and punctuation (`" * AND ( ) - :` ...) in agent input are inert and can
 * never cause a syntax error. Returns null when no token is left.
 */
export function buildMatchExpression(q: string): string | null {
  const tokens = q.match(/[\p{L}\p{N}]+/gu);
  return tokens ? tokens.map((t) => `"${t}"`).join(" ") : null;
}

/**
 * SQL condition: the issue id is in the index for `q`. Used by `listIssues`
 * so list and search share one matching path. Matches nothing when `q` has
 * no searchable token.
 */
/** Note: deleted issues are not indexed, so `includeDeleted` never surfaces them via `q`. */
export function issueMatchesCondition(q: string) {
  const match = buildMatchExpression(q);
  if (!match) return sql`0`;
  return sql`issues.id IN (SELECT issue_id FROM search_index WHERE search_index MATCH ${match})`;
}

// Title hits weigh 10x body hits; the three UNINDEXED columns come first.
const BM25 = sql.raw("bm25(search_index, 0, 0, 0, 10.0, 1.0)");

type Row = {
  issue_id: string;
  identifier: string;
  title: string;
  kind: "issue" | "comment";
  snippet: string;
};

function runSearch(db: DbHandle, match: string, projectId?: string): Row[] {
  // Best-ranked row first; the first row per issue wins when grouping below.
  return db.all<Row>(sql`
    SELECT i.id AS issue_id, i.identifier AS identifier, i.title AS title,
           s.kind AS kind,
           snippet(search_index, -1, '<mark>', '</mark>', '…', 12) AS snippet
    FROM search_index s
    JOIN issues i ON i.id = s.issue_id
    WHERE search_index MATCH ${match}
      AND i.deleted_at IS NULL
      ${projectId ? sql`AND i.project_id = ${projectId}` : sql``}
    ORDER BY ${BM25}, i.id
  `);
}

export function createSearchService(ctx: ServiceContext) {
  return {
    /**
     * Full-text search over issue titles/descriptions and comments, one result
     * per issue, best match first. A query with no searchable word (blank or
     * only punctuation) returns an empty page rather than an error. Tokens are
     * AND-ed within a single indexed row (an issue, or one comment), so words
     * split between an issue and a comment do not match together.
     * Pagination is offset-based: `cursor` is opaque.
     */
    search(input: SearchInput): Page<SearchResult> {
      const data = parseInput(searchInputSchema, input);
      const match = buildMatchExpression(data.q);
      if (!match) return { items: [], nextCursor: null };
      const project = data.project
        ? resolveProject(ctx.db, data.project)
        : undefined;
      let offset = 0;
      if (data.cursor) {
        const payload = decodeCursor(data.cursor) as { offset?: unknown };
        if (
          typeof payload.offset !== "number" ||
          !Number.isInteger(payload.offset) ||
          payload.offset < 0
        ) {
          throw new ServiceError("validation_error", "Invalid cursor");
        }
        offset = payload.offset;
      }
      const limit = Math.min(data.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

      const seen = new Set<string>();
      const grouped: SearchResult[] = [];
      for (const r of runSearch(ctx.db, match, project?.id)) {
        if (seen.has(r.issue_id)) continue;
        seen.add(r.issue_id);
        grouped.push({
          issueId: r.issue_id,
          identifier: r.identifier,
          title: r.title,
          source: r.kind,
          snippet: r.snippet,
        });
      }
      const items = grouped.slice(offset, offset + limit);
      return {
        items,
        nextCursor:
          grouped.length > offset + limit
            ? encodeCursor({ offset: offset + limit })
            : null,
      };
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
