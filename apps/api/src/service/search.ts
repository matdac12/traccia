import { ServiceError } from "@traccia/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  DEFAULT_LIMIT,
  decodeCursor,
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

/** One plain-text fragment of a snippet. Never HTML: safe as a React child. */
export type SnippetSegment = {
  text: string;
  /** True when this fragment is a search hit (render it emphasised). */
  match: boolean;
};

export type SearchResult = {
  issueId: string;
  identifier: string;
  title: string;
  /** Where the best match was found. */
  source: "issue" | "comment";
  /**
   * The matching fragment as plain-text segments with the hits flagged. The API
   * never returns HTML: the surrounding issue/comment text stays raw text, so a
   * consumer cannot render unescaped user input as markup by mistake.
   */
  snippet: SnippetSegment[];
};

/**
 * Turns free text into a safe FTS5 MATCH expression. Every run of letters or
 * digits becomes its own double-quoted token (implicitly AND-ed), so operators
 * and punctuation (`" * AND ( ) - :` ...) in agent input are inert and can
 * never cause a syntax error. The last token is a prefix query (`"perch"*`), so
 * a partial last word matches (`perch` finds `perché`, `deplo` finds `deploy`);
 * earlier tokens must match whole. Returns null when no token is left.
 */
export function buildMatchExpression(q: string): string | null {
  const tokens = q.match(/[\p{L}\p{N}]+/gu);
  if (!tokens) return null;
  const last = tokens.length - 1;
  return tokens
    .map((t, i) => (i === last ? `"${t}"*` : `"${t}"`))
    .join(" ");
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

/**
 * FTS5 `snippet()` wraps hits in these markers. They are private-use code
 * points, so real text never contains them; the raw snippet can be split back
 * into plain-text segments without HTML escaping.
 */
const HIT_START = "\uE000";
const HIT_END = "\uE001";

/** Splits a raw FTS5 snippet (with the markers above) into plain-text segments. */
function parseSnippet(raw: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let text = "";
  let match = false;
  const flush = () => {
    if (text) segments.push({ text, match });
    text = "";
  };
  for (const ch of raw) {
    if (ch === HIT_START) {
      flush();
      match = true;
    } else if (ch === HIT_END) {
      flush();
      match = false;
    } else {
      text += ch;
    }
  }
  flush();
  return segments;
}

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
           snippet(search_index, -1, ${HIT_START}, ${HIT_END}, '…', 12) AS snippet
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
          snippet: parseSnippet(r.snippet),
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
