import type { ActivityType, Actor } from "@traccia/shared";
import { inArray } from "drizzle-orm";
import { issues } from "../db/schema.js";
import type { Tx } from "./context.js";
import { assertValidParent, loadSubtree } from "./hierarchy.js";
import {
  assertMilestoneInProject,
  type Issue,
  recordActivity,
  resolveIssue,
} from "./issues.js";
import type { Project } from "./projects.js";

type Patch = {
  milestoneId?: string | null;
  parentId?: string | null;
};

/**
 * Applies the project / parent / milestone part of an issue update inside the
 * caller's transaction and returns the columns to set on the issue itself.
 *
 * Moving to another project keeps the identifier. The issue's parent and
 * milestone are cleared unless the patch gives ones valid in the new project,
 * and the whole subtree moves with it (descendants' milestones are cleared,
 * their parent links stay). Each change writes its activity row.
 */
export function applyStructureChanges(
  tx: Tx,
  issue: Issue,
  target: Project | null,
  patch: Patch,
  actor: Actor,
  now: string,
): Partial<typeof issues.$inferInsert> {
  const set: Partial<typeof issues.$inferInsert> = {};
  const log = (id: string, type: ActivityType, data: Record<string, unknown>) =>
    recordActivity(tx, id, actor, type, data, now);
  const moving = target !== null && target.id !== issue.projectId;
  const projectId = moving ? target.id : issue.projectId;

  const wantedParent =
    patch.parentId !== undefined ? patch.parentId : moving ? null : undefined;
  if (wantedParent !== undefined) {
    const parent = wantedParent ? resolveIssue(tx, wantedParent) : null;
    const parentId = parent?.id ?? null;
    // When moving, an explicit parent is re-validated even if unchanged: it
    // would otherwise stay behind in the old project.
    if (parent && (moving || parentId !== issue.parentId)) {
      assertValidParent(tx, issue, parent, projectId);
    }
    if (parentId !== issue.parentId) {
      set.parentId = parentId;
      log(issue.id, "parent_changed", { from: issue.parentId, to: parentId });
    }
  }

  const wantedMilestone =
    patch.milestoneId !== undefined
      ? patch.milestoneId
      : moving
        ? null
        : undefined;
  if (wantedMilestone && (moving || wantedMilestone !== issue.milestoneId)) {
    assertMilestoneInProject(tx, wantedMilestone, projectId);
  }
  if (wantedMilestone !== undefined && wantedMilestone !== issue.milestoneId) {
    set.milestoneId = wantedMilestone;
    log(issue.id, "milestone_changed", {
      from: issue.milestoneId,
      to: wantedMilestone,
    });
  }

  if (moving) {
    set.projectId = projectId;
    log(issue.id, "project_changed", {
      from: issue.projectId,
      to: projectId,
    });
    const descendants = loadSubtree(tx, issue).rows.filter(
      (r) => r.id !== issue.id,
    );
    for (const d of descendants) {
      log(d.id, "project_changed", { from: d.projectId, to: projectId });
      if (d.milestoneId) {
        log(d.id, "milestone_changed", { from: d.milestoneId, to: null });
      }
    }
    if (descendants.length > 0) {
      tx.update(issues)
        .set({ projectId, milestoneId: null, updatedAt: now })
        .where(
          inArray(
            issues.id,
            descendants.map((d) => d.id),
          ),
        )
        .run();
    }
  }
  return set;
}
