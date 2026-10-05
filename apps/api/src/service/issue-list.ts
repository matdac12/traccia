import {
  type IssueOrderBy,
  type ListIssuesInput,
  listIssuesInputSchema,
  ServiceError,
} from "@linear-matti/shared";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { issueLabels, issues, labels, milestones } from "../db/schema.js";
import {
  decodeCursor,
  DEFAULT_LIMIT,
  encodeCursor,
  MAX_LIMIT,
  type Page,
} from "../rest/pagination.js";
import { type DbHandle, parseInput, type ServiceContext } from "./context.js";
import type { Issue } from "./issues.js";
import { resolveIssue } from "./issues.js";
import { resolveProject } from "./projects.js";
import { issueMatchesCondition } from "./search.js";

const ORDER_COLUMNS = {
  updatedAt: issues.updatedAt,
  createdAt: issues.createdAt,
  priority: issues.priority,
  sortOrder: issues.sortOrder,
} as const;

const NUMERIC_ORDERS = new Set<IssueOrderBy>(["priority", "sortOrder"]);

type Cursor = {
  by: IssueOrderBy;
  order: "asc" | "desc";
  v: string | number;
  id: string;
};

function parseCursor(
  raw: string,
  by: IssueOrderBy,
  order: "asc" | "desc",
): Cursor {
  let payload: Partial<Cursor>;
  try {
    payload = decodeCursor(raw) as Partial<Cursor>;
  } catch {
    throw new ServiceError("validation_error", "Invalid cursor");
  }
  const valid =
    payload.by === by &&
    payload.order === order &&
    typeof payload.id === "string" &&
    typeof payload.v === (NUMERIC_ORDERS.has(by) ? "number" : "string");
  if (!valid) {
    throw new ServiceError(
      "validation_error",
      "Invalid cursor (or it belongs to a different orderBy/order)",
    );
  }
  return payload as Cursor;
}

function resolveMilestoneIds(
  db: DbHandle,
  ref: string,
  projectId: string | undefined,
): string[] {
  const rows = db
    .select({ id: milestones.id })
    .from(milestones)
    .where(
      and(
        isNull(milestones.deletedAt),
        or(eq(milestones.id, ref), eq(milestones.name, ref)),
        projectId ? eq(milestones.projectId, projectId) : undefined,
      ),
    )
    .all();
  if (rows.length === 0) {
    throw new ServiceError("not_found", `Milestone "${ref}" not found`);
  }
  return rows.map((r) => r.id);
}

/**
 * Builds the filtered, ordered query. Combination rules (documented contract):
 *  - different filters are AND-ed together;
 *  - repeated `status` values are OR-ed with each other;
 *  - repeated `label` names are AND-ed: the issue must have every named label
 *    (names match case-insensitively, global or project-scoped).
 * Ordering always ends with `id` in the same direction as a stable tiebreaker.
 * Exported separately so tests can EXPLAIN it.
 */
export function buildIssueListQuery(db: DbHandle, input: ListIssuesInput) {
  const f = parseInput(listIssuesInputSchema, input);
  const project = f.project ? resolveProject(db, f.project) : undefined;

  const conditions: Array<SQL | undefined> = [
    f.includeDeleted ? undefined : isNull(issues.deletedAt),
    project ? eq(issues.projectId, project.id) : undefined,
    f.status?.length ? inArray(issues.status, f.status) : undefined,
    f.assignee === "none"
      ? isNull(issues.assignee)
      : f.assignee
        ? eq(issues.assignee, f.assignee)
        : undefined,
    f.milestone
      ? inArray(
          issues.milestoneId,
          resolveMilestoneIds(db, f.milestone, project?.id),
        )
      : undefined,
    f.parent ? eq(issues.parentId, resolveIssue(db, f.parent).id) : undefined,
    f.priority !== undefined ? eq(issues.priority, f.priority) : undefined,
    f.createdBy ? eq(issues.createdBy, f.createdBy) : undefined,
    f.updatedAfter ? gt(issues.updatedAt, f.updatedAfter) : undefined,
    f.q?.trim() ? issueMatchesCondition(f.q) : undefined,
  ];
  for (const name of new Set((f.label ?? []).map((n) => n.toLowerCase()))) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(issueLabels)
          .innerJoin(labels, eq(labels.id, issueLabels.labelId))
          .where(
            and(
              eq(issueLabels.issueId, issues.id),
              isNull(labels.deletedAt),
              sql`lower(${labels.name}) = ${name}`,
            ),
          ),
      ),
    );
  }

  const column = ORDER_COLUMNS[f.orderBy];
  const dir = f.order === "asc" ? asc : desc;
  if (f.cursor) {
    const c = parseCursor(f.cursor, f.orderBy, f.order);
    const past = f.order === "asc" ? gt : lt;
    conditions.push(
      or(past(column, c.v), and(eq(column, c.v), past(issues.id, c.id))),
    );
  }

  const limit = Math.min(f.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const query = db
    .select()
    .from(issues)
    .where(and(...conditions))
    .orderBy(dir(column), dir(issues.id))
    .limit(limit + 1);
  return { query, limit, orderBy: f.orderBy, order: f.order };
}

export function createIssueListService(ctx: ServiceContext) {
  return {
    /** Cursor-paginated issue list; see `buildIssueListQuery` for the filter rules. */
    list(input: ListIssuesInput = {}): Page<Issue> {
      const { query, limit, orderBy, order } = buildIssueListQuery(
        ctx.db,
        input,
      );
      const rows = query.all();
      const items = rows.slice(0, limit);
      const last = items[items.length - 1];
      return {
        items,
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({
                by: orderBy,
                order,
                v: last[orderBy],
                id: last.id,
              } satisfies Cursor)
            : null,
      };
    },
  };
}
