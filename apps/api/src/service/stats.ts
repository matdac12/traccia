import { ISSUE_STATUSES, type IssueStatus } from "@traccia/shared";
import { and, count, inArray, isNull } from "drizzle-orm";
import { issues } from "../db/schema.js";
import type { ServiceContext } from "./context.js";

export type IssueCounts = Record<IssueStatus, number>;
export type MilestoneProgress = { done: number; total: number };

const emptyCounts = (): IssueCounts =>
  Object.fromEntries(ISSUE_STATUSES.map((s) => [s, 0])) as IssueCounts;

/** Read-only aggregates shown next to projects and milestones. */
export function createStatsService(ctx: ServiceContext) {
  return {
    /** Live issues per status for each project id; every status is present. */
    issueCountsByProject(projectIds: string[]): Map<string, IssueCounts> {
      const result = new Map(projectIds.map((id) => [id, emptyCounts()]));
      if (!projectIds.length) return result;
      const rows = ctx.db
        .select({
          projectId: issues.projectId,
          status: issues.status,
          n: count(),
        })
        .from(issues)
        .where(
          and(inArray(issues.projectId, projectIds), isNull(issues.deletedAt)),
        )
        .groupBy(issues.projectId, issues.status)
        .all();
      for (const r of rows) {
        const counts = result.get(r.projectId);
        if (counts) counts[r.status] = r.n;
      }
      return result;
    },

    /**
     * Progress per milestone id: `done` issues out of live, non-canceled
     * issues in the milestone.
     */
    progressByMilestone(
      milestoneIds: string[],
    ): Map<string, MilestoneProgress> {
      const result = new Map<string, MilestoneProgress>(
        milestoneIds.map((id) => [id, { done: 0, total: 0 }]),
      );
      if (!milestoneIds.length) return result;
      const rows = ctx.db
        .select({
          milestoneId: issues.milestoneId,
          status: issues.status,
          n: count(),
        })
        .from(issues)
        .where(
          and(
            inArray(issues.milestoneId, milestoneIds),
            isNull(issues.deletedAt),
          ),
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
    },
  };
}
