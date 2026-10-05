import { ServiceError } from "@linear-matti/shared";
import { eq, inArray } from "drizzle-orm";
import { issues } from "../db/schema.js";
import type { DbHandle } from "./context.js";

type IssueRow = typeof issues.$inferSelect;

/** Sub-issue nesting limit: a root issue is level 1. */
export const MAX_ISSUE_DEPTH = 3;

/** Levels from the root down to `issue`, inclusive (a root issue is 1). */
function levelOf(db: DbHandle, issue: IssueRow): number {
  const seen = new Set<string>([issue.id]);
  let level = 1;
  let parentId = issue.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = db
      .select()
      .from(issues)
      .where(eq(issues.id, parentId))
      .get();
    if (!parent) break;
    level += 1;
    parentId = parent.parentId;
  }
  return level;
}

/**
 * `issue` plus all of its descendants (deleted ones included, so a restore
 * can never bring back a child in another project), with the number of levels
 * the subtree spans (just the issue is 1).
 */
export function loadSubtree(
  db: DbHandle,
  issue: IssueRow,
): { rows: IssueRow[]; height: number } {
  const rows = [issue];
  const seen = new Set<string>([issue.id]);
  let frontier = [issue.id];
  let height = 1;
  while (frontier.length > 0) {
    const children = db
      .select()
      .from(issues)
      .where(inArray(issues.parentId, frontier))
      .all()
      .filter((c) => !seen.has(c.id));
    if (children.length === 0) break;
    height += 1;
    for (const c of children) seen.add(c.id);
    rows.push(...children);
    frontier = children.map((c) => c.id);
  }
  return { rows, height };
}

/**
 * Checks that `issue` (null for one being created) may sit under `parent` in
 * `projectId`: same project, no cycle, and the whole subtree stays within
 * `MAX_ISSUE_DEPTH` levels.
 */
export function assertValidParent(
  db: DbHandle,
  issue: IssueRow | null,
  parent: IssueRow,
  projectId: string,
): void {
  if (parent.projectId !== projectId) {
    throw new ServiceError(
      "validation_error",
      "Parent must be in the same project",
      { parentId: parent.id },
    );
  }
  let subtreeHeight = 1;
  if (issue) {
    const subtree = loadSubtree(db, issue);
    if (subtree.rows.some((r) => r.id === parent.id)) {
      throw new ServiceError(
        "validation_error",
        parent.id === issue.id
          ? "An issue cannot be its own parent"
          : "Parent would create a cycle (it is a descendant of this issue)",
        { parentId: parent.id },
      );
    }
    subtreeHeight = subtree.height;
  }
  const depth = levelOf(db, parent) + subtreeHeight;
  if (depth > MAX_ISSUE_DEPTH) {
    throw new ServiceError(
      "validation_error",
      `Sub-issues can be nested at most ${MAX_ISSUE_DEPTH} levels deep`,
      { maxDepth: MAX_ISSUE_DEPTH, resultingDepth: depth },
    );
  }
}
