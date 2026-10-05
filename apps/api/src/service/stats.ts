import { ISSUE_STATUSES, type IssueStatus } from "@linear-matti/shared";
import { and, count, inArray, isNull } from "drizzle-orm";
import { issues } from "../db/schema.js";
import type { DbHandle } from "./context.js";

export type IssueCounts = Record<IssueStatus, number>;
export type MilestoneProgress = { done: number; total: number };

/** Live issues per status for each project id (every status present, 0 if none). */
export function issueCountsByProject(
  db: DbHandle,
  projectIds: string[],
): Map<string, IssueCounts> {
  const result = new Map<string, IssueCounts>();
  for (const id of projectIds) {
    result.set(
      id,
      Object.fromEntries(ISSUE_STATUSES.map((s) => [s, 0])) as IssueCounts,
    );
  }
  if (projectIds.length === 0) return result;
  const rows = db
    .select({
      projectId: issues.projectId,
      status: issues.status,
      n: count(),
    })
    .from(issues)
    .where(and(inArray(issues.projectId, projectIds), isNull(issues.deletedAt)))
    .groupBy(issues.projectId, issues.status)
    .all();
  for (const r of rows) {
    const counts = result.get(r.projectId);
    if (counts) counts[r.status] = r.n;
  }
  return result;
}

/**
 * Milestone progress: `total` counts live issues that are not canceled,
 * `done` those with status `done`. Canceled work does not hold a milestone back.
 */
export function milestoneProgress(
  db: DbHandle,
  milestoneIds: string[],
): Map<string, MilestoneProgress> {
  const result = new Map<string, MilestoneProgress>();
  for (const id of milestoneIds) result.set(id, { done: 0, total: 0 });
  if (milestoneIds.length === 0) return result;
  const rows = db
    .select({
      milestoneId: issues.milestoneId,
      status: issues.status,
      n: count(),
    })
    .from(issues)
    .where(
      and(inArray(issues.milestoneId, milestoneIds), isNull(issues.deletedAt)),
    )
    .groupBy(issues.milestoneId, issues.status)
    .all();
  for (const r of rows) {
    const p = r.milestoneId ? result.get(r.milestoneId) : undefined;
    if (!p || r.status === "canceled") continue;
    p.total += r.n;
    if (r.status === "done") p.done += r.n;
  }
  return result;
}
