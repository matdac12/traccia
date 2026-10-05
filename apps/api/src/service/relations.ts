import {
  type Actor,
  type IssueStatus,
  ServiceError,
} from "@linear-matti/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { issueRelations, issues } from "../db/schema.js";
import { nowIso } from "../time.js";
import type { DbHandle, ServiceContext } from "./context.js";
import { recordActivity, resolveIssue } from "./issues.js";

/** The other end of a blocker relation. */
export type RelatedIssue = {
  id: string;
  identifier: string;
  title: string;
  status: IssueStatus;
};

export type IssueRelations = {
  /** Issues that must finish before this one. */
  blockedBy: RelatedIssue[];
  /** Issues this one blocks. */
  blocks: RelatedIssue[];
};

export const NO_RELATIONS: IssueRelations = { blockedBy: [], blocks: [] };

const relatedColumns = {
  id: issues.id,
  identifier: issues.identifier,
  title: issues.title,
  status: issues.status,
};

/** Both directions of blocker relations for an issue; deleted issues are hidden. */
export function loadRelations(db: DbHandle, issueId: string): IssueRelations {
  return {
    blockedBy: db
      .select(relatedColumns)
      .from(issueRelations)
      .innerJoin(issues, eq(issues.id, issueRelations.blockerId))
      .where(
        and(eq(issueRelations.blockedId, issueId), isNull(issues.deletedAt)),
      )
      .orderBy(asc(issues.number), asc(issues.id))
      .all(),
    blocks: db
      .select(relatedColumns)
      .from(issueRelations)
      .innerJoin(issues, eq(issues.id, issueRelations.blockedId))
      .where(
        and(eq(issueRelations.blockerId, issueId), isNull(issues.deletedAt)),
      )
      .orderBy(asc(issues.number), asc(issues.id))
      .all(),
  };
}

function relationExists(db: DbHandle, blockerId: string, blockedId: string) {
  return !!db
    .select()
    .from(issueRelations)
    .where(
      and(
        eq(issueRelations.blockerId, blockerId),
        eq(issueRelations.blockedId, blockedId),
      ),
    )
    .get();
}

/** "A blocks B" relations. Blockers may cross projects. */
export function createRelationsService(ctx: ServiceContext) {
  return {
    /**
     * Records that `blockerRef` blocks `blockedRef`. Idempotent: an existing
     * relation is a no-op with no activity. Self-relations and direct cycles
     * (B already blocks A) are a `validation_error`. Returns whether anything
     * changed.
     */
    addBlocker(actor: Actor, blockerRef: string, blockedRef: string): boolean {
      return ctx.write((tx) => {
        const blocker = resolveIssue(tx, blockerRef);
        const blocked = resolveIssue(tx, blockedRef);
        if (blocker.id === blocked.id) {
          throw new ServiceError(
            "validation_error",
            "An issue cannot block itself",
          );
        }
        if (relationExists(tx, blocker.id, blocked.id)) return false;
        if (relationExists(tx, blocked.id, blocker.id)) {
          throw new ServiceError(
            "validation_error",
            `${blocked.identifier} already blocks ${blocker.identifier}`,
            { blocker: blocker.identifier, blocked: blocked.identifier },
          );
        }
        const now = nowIso();
        tx.insert(issueRelations)
          .values({
            blockerId: blocker.id,
            blockedId: blocked.id,
            createdAt: now,
          })
          .run();
        const data = {
          blocker: blocker.identifier,
          blocked: blocked.identifier,
        };
        recordActivity(tx, blocker.id, actor, "blocker_added", data, now);
        recordActivity(tx, blocked.id, actor, "blocker_added", data, now);
        return true;
      });
    },

    /** Removes the relation if present; idempotent. Returns whether anything changed. */
    removeBlocker(
      actor: Actor,
      blockerRef: string,
      blockedRef: string,
    ): boolean {
      return ctx.write((tx) => {
        const blocker = resolveIssue(tx, blockerRef);
        const blocked = resolveIssue(tx, blockedRef);
        if (!relationExists(tx, blocker.id, blocked.id)) return false;
        tx.delete(issueRelations)
          .where(
            and(
              eq(issueRelations.blockerId, blocker.id),
              eq(issueRelations.blockedId, blocked.id),
            ),
          )
          .run();
        const now = nowIso();
        const data = {
          blocker: blocker.identifier,
          blocked: blocked.identifier,
        };
        recordActivity(tx, blocker.id, actor, "blocker_removed", data, now);
        recordActivity(tx, blocked.id, actor, "blocker_removed", data, now);
        return true;
      });
    },
  };
}

export type RelationsService = ReturnType<typeof createRelationsService>;
