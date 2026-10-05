import {
  type ActivityType,
  type Actor,
  type CreateIssueInput,
  createIssueInputSchema,
  type IssueInclude,
  type IssueStatus,
  ServiceError,
  type UpdateIssueInput,
  updateIssueInputSchema,
} from "@linear-matti/shared";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { activity, issues, milestones } from "../db/schema.js";
import { newId } from "../ids.js";
import { nowIso } from "../time.js";
import {
  type DbHandle,
  parseInput,
  type ServiceContext,
  type Tx,
} from "./context.js";
import { type CommentThread, listIssueComments } from "./comments.js";
import { assertValidParent } from "./hierarchy.js";
import { allocateIssueNumber } from "./issue-keys.js";
import { indexIssue } from "./search-index.js";
import { applyStructureChanges } from "./issue-structure.js";
import { setIssueLabels } from "./labels.js";
import { resolveProject } from "./projects.js";
import {
  type IssueRelations,
  loadRelations,
  NO_RELATIONS,
} from "./relations.js";

export type Issue = typeof issues.$inferSelect;
export type Activity = typeof activity.$inferSelect;

/** An issue plus the requested `include` collections (empty until those features land). */
export type IssueDetail = Issue & {
  comments: CommentThread[];
  activity: Activity[];
  attachments: unknown[];
  children: Issue[];
  relations: IssueRelations;
};

/** Writes one activity row; call inside the same transaction as the change. */
export function recordActivity(
  tx: Tx,
  issueId: string,
  actor: Actor,
  type: ActivityType,
  data: Record<string, unknown>,
  createdAt: string,
): void {
  tx.insert(activity)
    .values({
      id: newId(),
      issueId,
      actor,
      type,
      data: JSON.stringify(data),
      createdAt,
    })
    .run();
}

/** Looks up a live issue by identifier (`MAT-12`) or ULID. */
export function resolveIssue(db: DbHandle, ref: string): Issue {
  const row = db
    .select()
    .from(issues)
    .where(
      and(
        or(eq(issues.id, ref), eq(issues.identifier, ref.toUpperCase())),
        isNull(issues.deletedAt),
      ),
    )
    .get();
  if (!row) throw new ServiceError("not_found", `Issue "${ref}" not found`);
  return row;
}

export function assertMilestoneInProject(
  db: DbHandle,
  milestoneId: string,
  projectId: string,
): void {
  const m = db
    .select()
    .from(milestones)
    .where(and(eq(milestones.id, milestoneId), isNull(milestones.deletedAt)))
    .get();
  if (!m) {
    throw new ServiceError("not_found", `Milestone "${milestoneId}" not found`);
  }
  if (m.projectId !== projectId) {
    throw new ServiceError(
      "validation_error",
      "Milestone does not belong to the issue's project",
      { milestoneId, projectId },
    );
  }
}

/** Timestamp columns implied by entering `status`, applied on top of `current`. */
export function statusTimestamps(
  status: IssueStatus,
  current: Pick<Issue, "startedAt" | "completedAt" | "canceledAt">,
  now: string,
) {
  return {
    startedAt:
      status === "in_progress" ? (current.startedAt ?? now) : current.startedAt,
    completedAt: status === "done" ? (current.completedAt ?? now) : null,
    canceledAt: status === "canceled" ? (current.canceledAt ?? now) : null,
  };
}

/**
 * Hook run inside the update transaction after the field changes, so other
 * services (labels, MAT-1695) can attach/detach in the same commit. Return
 * true if it changed anything, so the issue's `updated_at` is bumped.
 */
export type IssueUpdateHook = (tx: Tx, issue: Issue, actor: Actor) => boolean;

export function createIssuesService(ctx: ServiceContext) {
  return {
    create(actor: Actor, input: CreateIssueInput): Issue {
      const data = parseInput(createIssueInputSchema, input);
      return ctx.write((tx) => {
        const project = resolveProject(tx, data.project);
        if (data.milestoneId) {
          assertMilestoneInProject(tx, data.milestoneId, project.id);
        }
        const parent = data.parentId ? resolveIssue(tx, data.parentId) : null;
        if (parent) assertValidParent(tx, null, parent, project.id);
        const status = data.status ?? "backlog";
        const now = nowIso();
        const number = allocateIssueNumber(tx, project.key);
        const issue = tx
          .insert(issues)
          .values({
            id: newId(),
            projectId: project.id,
            key: project.key,
            number,
            identifier: `${project.key}-${number}`,
            title: data.title,
            description: data.description ?? "",
            status,
            priority: data.priority ?? 0,
            estimate: data.estimate ?? null,
            assignee: data.assignee ?? null,
            milestoneId: data.milestoneId ?? null,
            parentId: parent?.id ?? null,
            sortOrder: data.sortOrder ?? 0,
            createdBy: actor,
            createdAt: now,
            updatedAt: now,
            ...statusTimestamps(
              status,
              { startedAt: null, completedAt: null, canceledAt: null },
              now,
            ),
          })
          .returning()
          .get();
        indexIssue(tx, issue);
        recordActivity(
          tx,
          issue.id,
          actor,
          "issue_created",
          { identifier: issue.identifier },
          now,
        );
        return issue;
      });
    },

    get(ref: string, include: IssueInclude[] = []): IssueDetail {
      const issue = resolveIssue(ctx.db, ref);
      return {
        ...issue,
        comments: include.includes("comments")
          ? listIssueComments(ctx.db, issue.id)
          : [],
        attachments: [],
        relations: include.includes("relations")
          ? loadRelations(ctx.db, issue.id)
          : NO_RELATIONS,
        activity: include.includes("activity")
          ? ctx.db
              .select()
              .from(activity)
              .where(eq(activity.issueId, issue.id))
              .orderBy(asc(activity.createdAt), asc(activity.id))
              .all()
          : [],
        children: include.includes("children")
          ? ctx.db
              .select()
              .from(issues)
              .where(
                and(eq(issues.parentId, issue.id), isNull(issues.deletedAt)),
              )
              .orderBy(asc(issues.sortOrder), asc(issues.id))
              .all()
          : [],
      };
    },

    /**
     * Partial update by identifier or ULID. One activity row per changed
     * field; unchanged fields write nothing. A stale `expectedUpdatedAt` is a
     * `conflict` and leaves the row untouched. `hook` is the extension point
     * for label attach/detach (see `IssueUpdateHook`).
     */
    update(
      actor: Actor,
      ref: string,
      input: UpdateIssueInput,
      hook?: IssueUpdateHook,
    ): Issue {
      const { expectedUpdatedAt, ...patch } = parseInput(
        updateIssueInputSchema,
        input,
      );
      return ctx.write((tx) => {
        const issue = resolveIssue(tx, ref);
        if (expectedUpdatedAt && expectedUpdatedAt !== issue.updatedAt) {
          throw new ServiceError(
            "conflict",
            "Issue was modified since it was read",
            { currentUpdatedAt: issue.updatedAt },
          );
        }
        const now = nowIso();
        const set: Partial<typeof issues.$inferInsert> = {};
        const log = (type: ActivityType, data: Record<string, unknown>) =>
          recordActivity(tx, issue.id, actor, type, data, now);

        if (patch.title !== undefined && patch.title !== issue.title) {
          set.title = patch.title;
          log("title_changed", { from: issue.title, to: patch.title });
        }
        if (
          patch.description !== undefined &&
          patch.description !== issue.description
        ) {
          set.description = patch.description;
          log("description_changed", { oldLength: issue.description.length });
        }
        if (patch.status !== undefined && patch.status !== issue.status) {
          Object.assign(set, {
            status: patch.status,
            ...statusTimestamps(patch.status, issue, now),
          });
          log("status_changed", { from: issue.status, to: patch.status });
        }
        if (patch.priority !== undefined && patch.priority !== issue.priority) {
          set.priority = patch.priority;
          log("priority_changed", { from: issue.priority, to: patch.priority });
        }
        if (patch.estimate !== undefined && patch.estimate !== issue.estimate) {
          set.estimate = patch.estimate;
          log("estimate_changed", { from: issue.estimate, to: patch.estimate });
        }
        if (patch.assignee !== undefined && patch.assignee !== issue.assignee) {
          set.assignee = patch.assignee;
          log("assignee_changed", { from: issue.assignee, to: patch.assignee });
        }
        // project / parent / milestone: see issue-structure.ts
        Object.assign(
          set,
          applyStructureChanges(
            tx,
            issue,
            patch.project ? resolveProject(tx, patch.project) : null,
            patch,
            actor,
            now,
          ),
        );
        // sort_order is ordering, not content: no activity row.
        if (
          patch.sortOrder !== undefined &&
          patch.sortOrder !== issue.sortOrder
        ) {
          set.sortOrder = patch.sortOrder;
        }

        // Same transaction: an unknown label name rolls back the whole update.
        let labelsChanged = false;
        if (patch.labels !== undefined) {
          const { added, removed } = setIssueLabels(
            tx,
            actor,
            issue.id,
            patch.labels,
          );
          labelsChanged = added.length + removed.length > 0;
        }
        const extraChanged =
          (hook?.(tx, issue, actor) ?? false) || labelsChanged;
        if (Object.keys(set).length === 0 && !extraChanged) return issue;
        const updated = tx
          .update(issues)
          .set({ ...set, updatedAt: now })
          .where(eq(issues.id, issue.id))
          .returning()
          .get();
        if (set.title !== undefined || set.description !== undefined) {
          indexIssue(tx, updated);
        }
        return updated;
      });
    },
  };
}

export type IssuesService = ReturnType<typeof createIssuesService>;
