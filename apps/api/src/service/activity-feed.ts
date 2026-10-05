import { type Actor, ServiceError } from "@traccia/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  DEFAULT_LIMIT,
  decodeCursor,
  encodeCursor,
  MAX_LIMIT,
  type Page,
} from "../rest/pagination.js";
import { parseInput, type ServiceContext } from "./context.js";

export const activityFeedInputSchema = z.object({
  limit: z.number().int().min(1).optional(),
  cursor: z.string().min(1).optional(),
});
export type ActivityFeedInput = z.input<typeof activityFeedInputSchema>;

/** One activity row with the issue it belongs to, for display. */
export type ActivityFeedItem = {
  id: string;
  issueId: string;
  identifier: string;
  title: string;
  actor: Actor;
  type: string;
  /** Parsed `data` of the activity row. */
  data: Record<string, unknown>;
  createdAt: string;
};

type Row = {
  id: string;
  issue_id: string;
  identifier: string;
  title: string;
  actor: Actor;
  type: string;
  data: string;
  created_at: string;
};

function parseData(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function createActivityFeedService(ctx: ServiceContext) {
  return {
    /**
     * Recent activity across issues, newest first (keyset-paginated on
     * `created_at`, then id). Activity of soft-deleted issues is hidden with
     * them and returns on restore.
     */
    list(input: ActivityFeedInput = {}): Page<ActivityFeedItem> {
      const q = parseInput(activityFeedInputSchema, input);
      const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      let after: { d: string; i: string } | undefined;
      if (q.cursor) {
        const c = decodeCursor(q.cursor) as { d?: unknown; i?: unknown };
        if (typeof c.d !== "string" || typeof c.i !== "string") {
          throw new ServiceError("validation_error", "Invalid cursor");
        }
        after = { d: c.d, i: c.i };
      }
      const rows = ctx.db.all<Row>(sql`
        SELECT a.id, a.issue_id, i.identifier, i.title, a.actor, a.type, a.data, a.created_at
        FROM activity a
        JOIN issues i ON i.id = a.issue_id
        WHERE i.deleted_at IS NULL
          AND ${after ? sql`(a.created_at < ${after.d} OR (a.created_at = ${after.d} AND a.id < ${after.i}))` : sql`1`}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${limit + 1}
      `);
      const items = rows.slice(0, limit).map((r) => ({
        id: r.id,
        issueId: r.issue_id,
        identifier: r.identifier,
        title: r.title,
        actor: r.actor,
        type: r.type,
        data: parseData(r.data),
        createdAt: r.created_at,
      }));
      const last = items[items.length - 1];
      return {
        items,
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({ d: last.createdAt, i: last.id })
            : null,
      };
    },
  };
}
