import {
  type Actor,
  type MoveIssuePositionInput,
  moveIssuePositionInputSchema,
  ServiceError,
} from "@traccia/shared";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { issues } from "../db/schema.js";
import { nowIso } from "../time.js";
import { parseInput, type ServiceContext, type Tx } from "./context.js";
import {
  type Issue,
  recordActivity,
  resolveIssue,
  statusTimestamps,
} from "./issues.js";

/** Spacing between neighbours after a rebalance and when appending at an end. */
export const POSITION_STEP = 1024;
/** Below this gap between neighbours the column is rebalanced. */
export const MIN_POSITION_GAP = 1e-6;

/**
 * Renumbers `column` (already in order) as STEP, 2*STEP, ... Only changed rows
 * are written, and `updated_at` is left alone: order is not content, and
 * bumping it would spuriously invalidate other callers' `expectedUpdatedAt`.
 */
function rebalance(tx: Tx, column: Issue[]): void {
  column.forEach((issue, i) => {
    const sortOrder = (i + 1) * POSITION_STEP;
    if (issue.sortOrder === sortOrder) return;
    tx.update(issues).set({ sortOrder }).where(eq(issues.id, issue.id)).run();
    issue.sortOrder = sortOrder;
  });
}

function between(prev: Issue | undefined, next: Issue | undefined): number {
  if (prev && next) return (prev.sortOrder + next.sortOrder) / 2;
  if (prev) return prev.sortOrder + POSITION_STEP;
  if (next) return next.sortOrder - POSITION_STEP;
  return POSITION_STEP;
}

export function createIssuePositionService(ctx: ServiceContext) {
  return {
    /**
     * Moves an issue within (or into) the column `(project, status)`.
     * `beforeId` places it directly above that issue, `afterId` directly below
     * that issue; with both they must be adjacent; with neither it goes to the
     * bottom. Lower `sort_order` is higher in the column. A fractional value
     * is computed between the neighbours, and the column is rebalanced when
     * the gap gets too small (or neighbours share a value). Crossing columns
     * changes status with the normal timestamps and a `status_changed` row.
     */
    move(actor: Actor, input: MoveIssuePositionInput): Issue {
      const data = parseInput(moveIssuePositionInputSchema, input);
      return ctx.write((tx) => {
        const issue = resolveIssue(tx, data.identifier);
        if (
          data.expectedUpdatedAt &&
          data.expectedUpdatedAt !== issue.updatedAt
        ) {
          throw new ServiceError(
            "conflict",
            "Issue was modified since it was read",
            { currentUpdatedAt: issue.updatedAt },
          );
        }
        const column = tx
          .select()
          .from(issues)
          .where(
            and(
              eq(issues.projectId, issue.projectId),
              eq(issues.status, data.status),
              isNull(issues.deletedAt),
              ne(issues.id, issue.id),
            ),
          )
          .orderBy(asc(issues.sortOrder), asc(issues.id))
          .all();

        const indexOf = (ref: string, label: string) => {
          const neighbour = resolveIssue(tx, ref);
          const i = column.findIndex((c) => c.id === neighbour.id);
          if (i < 0) {
            throw new ServiceError(
              "validation_error",
              `${label} must be another issue in the target column (same project, status "${data.status}")`,
              { [label]: ref },
            );
          }
          return i;
        };
        let index = column.length;
        if (data.afterId !== undefined)
          index = indexOf(data.afterId, "afterId") + 1;
        if (data.beforeId !== undefined) {
          const beforeIndex = indexOf(data.beforeId, "beforeId");
          if (data.afterId !== undefined && beforeIndex !== index) {
            throw new ServiceError(
              "validation_error",
              "beforeId and afterId must be adjacent issues",
            );
          }
          index = beforeIndex;
        }

        let prev = column[index - 1];
        let next = column[index];
        if (
          prev &&
          next &&
          next.sortOrder - prev.sortOrder < MIN_POSITION_GAP
        ) {
          rebalance(tx, column);
          prev = column[index - 1];
          next = column[index];
        }
        const sortOrder = between(prev, next);

        const now = nowIso();
        const set: Partial<typeof issues.$inferInsert> = { sortOrder };
        if (data.status !== issue.status) {
          Object.assign(set, {
            status: data.status,
            ...statusTimestamps(data.status, issue, now),
          });
          recordActivity(
            tx,
            issue.id,
            actor,
            "status_changed",
            {
              from: issue.status,
              to: data.status,
            },
            now,
          );
        }
        return tx
          .update(issues)
          .set({ ...set, updatedAt: now })
          .where(eq(issues.id, issue.id))
          .returning()
          .get();
      });
    },
  };
}
