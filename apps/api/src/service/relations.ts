import {
  type Actor,
  type IssueStatus,
  ServiceError,
} from "@linear-matti/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { issueRelations, issues } from "../db/schema.js";
import { nowIso } from "../time.js";
import type { DbHandle, ServiceContext, Tx } from "./context.js";
import { findBlockerPath, identifiersFor } from "./blocker-cycles.js";
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

/** See `addBlocker`; joins the caller's transaction. */
export function addBlockerTx(
  tx: Tx,
  actor: Actor,
  blockerRef: string,
  blockedRef: string,
): boolean {
  const blocker = resolveIssue(tx, blockerRef);
  const blocked = resolveIssue(tx, blockedRef);
  if (blocker.id === blocked.id) {
    throw new ServiceError("validation_error", "An issue cannot block itself");
  }
  if (relationExists(tx, blocker.id, blocked.id)) return false;
  // Adding "blocker blocks blocked" closes a cycle if blocked already
  // (transitively) blocks blocker.
  const back = findBlockerPath(tx, blocked.id, blocker.id);
  if (back) {
    const cycle = identifiersFor(tx, [blocker.id, ...back]);
    throw new ServiceError(
      "validation_error",
      `Blocker cycle: ${cycle.join(" -> ")} (each issue blocks the next). Remove one of these relations first.`,
      { blocker: blocker.identifier, blocked: blocked.identifier, cycle },
    );
  }
  const now = nowIso();
  tx.insert(issueRelations)
    .values({ blockerId: blocker.id, blockedId: blocked.id, createdAt: now })
    .run();
  const data = { blocker: blocker.identifier, blocked: blocked.identifier };
  recordActivity(tx, blocker.id, actor, "blocker_added", data, now);
  recordActivity(tx, blocked.id, actor, "blocker_added", data, now);
  return true;
}

/** See `removeBlocker`; joins the caller's transaction. */
export function removeBlockerTx(
  tx: Tx,
  actor: Actor,
  blockerRef: string,
  blockedRef: string,
): boolean {
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
  const data = { blocker: blocker.identifier, blocked: blocked.identifier };
  recordActivity(tx, blocker.id, actor, "blocker_removed", data, now);
  recordActivity(tx, blocked.id, actor, "blocker_removed", data, now);
  return true;
}

/**
 * Makes the blockers of `issueRef` exactly `blockedBy` and/or the issues it
 * blocks exactly `blocks` (omitted side untouched). Returns whether anything
 * changed. Meant as the `IssueUpdateHook` body so it commits with the update.
 */
export function setBlockersTx(
  tx: Tx,
  actor: Actor,
  issueRef: string,
  want: { blockedBy?: string[]; blocks?: string[] },
): boolean {
  const self = resolveIssue(tx, issueRef);
  const current = loadRelations(tx, self.id);
  type Edge = { blocker: string; blocked: string };
  const plan = (
    have: RelatedIssue[],
    refs: string[] | undefined,
    edge: (other: string) => Edge,
  ) => {
    if (refs === undefined) return { remove: [], add: [] };
    const wantIds = new Set(refs.map((r) => resolveIssue(tx, r).id));
    return {
      remove: have.filter((r) => !wantIds.has(r.id)).map((r) => edge(r.id)),
      add: [...wantIds].map(edge),
    };
  };
  const as = (other: string): Edge => ({ blocker: other, blocked: self.id });
  const to = (other: string): Edge => ({ blocker: self.id, blocked: other });
  const steps = [
    plan(current.blockedBy, want.blockedBy, as),
    plan(current.blocks, want.blocks, to),
  ];
  // Every removal lands before any add, so replacing both sets at once can't
  // trip the cycle check on an edge that is about to disappear.
  let changed = false;
  for (const e of steps.flatMap((s) => s.remove))
    changed = removeBlockerTx(tx, actor, e.blocker, e.blocked) || changed;
  for (const e of steps.flatMap((s) => s.add))
    changed = addBlockerTx(tx, actor, e.blocker, e.blocked) || changed;
  return changed;
}

/** "A blocks B" relations. Blockers may cross projects. */
export function createRelationsService(ctx: ServiceContext) {
  return {
    /**
     * Records that `blockerRef` blocks `blockedRef`. Idempotent: an existing
     * relation is a no-op with no activity. Self-relations and cycles (direct or
     * transitive, e.g. A→B→C→A) are a `validation_error`. Returns whether anything
     * changed.
     */
    addBlocker(actor: Actor, blockerRef: string, blockedRef: string): boolean {
      return ctx.write((tx) => addBlockerTx(tx, actor, blockerRef, blockedRef));
    },

    /** Removes the relation if present; idempotent. Returns whether anything changed. */
    removeBlocker(
      actor: Actor,
      blockerRef: string,
      blockedRef: string,
    ): boolean {
      return ctx.write((tx) =>
        removeBlockerTx(tx, actor, blockerRef, blockedRef),
      );
    },
  };
}

export type RelationsService = ReturnType<typeof createRelationsService>;
