import {
  type Actor,
  type CreateLabelInput,
  createLabelInputSchema,
  type ListLabelsInput,
  labelNamesSchema,
  listLabelsInputSchema,
  ServiceError,
  type UpdateLabelInput,
  updateLabelInputSchema,
} from "@traccia/shared";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { activity, issueLabels, issues, labels } from "../db/schema.js";
import { newId } from "../ids.js";
import { nowIso } from "../time.js";
import {
  type DbHandle,
  definedOnly,
  flagDeleted,
  parseInput,
  type ServiceContext,
  type Tx,
} from "./context.js";
import { resolveProject } from "./projects.js";

export type Label = typeof labels.$inferSelect;

const lowerName = (name: string) => name.toLowerCase();

function getLabel(db: DbHandle, id: string): Label {
  const row = db
    .select()
    .from(labels)
    .where(and(eq(labels.id, id), isNull(labels.deletedAt)))
    .get();
  if (!row) throw new ServiceError("not_found", `Label "${id}" not found`);
  return row;
}

/** Live label with this name (case-insensitive) in exactly this scope. */
function findInScope(
  db: DbHandle,
  projectId: string | null,
  name: string,
): Label | undefined {
  return db
    .select()
    .from(labels)
    .where(
      and(
        isNull(labels.deletedAt),
        projectId === null
          ? isNull(labels.projectId)
          : eq(labels.projectId, projectId),
        sql`lower(${labels.name}) = ${lowerName(name)}`,
      ),
    )
    .get();
}

function assertNameFree(
  db: DbHandle,
  projectId: string | null,
  name: string,
  exceptId?: string,
) {
  const clash = findInScope(db, projectId, name);
  if (clash && clash.id !== exceptId) {
    throw new ServiceError(
      "conflict",
      `A ${projectId === null ? "global" : "project"} label named "${clash.name}" already exists (names are case-insensitive within their scope)`,
      { labelId: clash.id },
    );
  }
}

/** Live labels an issue of `projectId` can use: its project's plus global ones. */
function labelsAvailableTo(db: DbHandle, projectId: string): Label[] {
  return db
    .select()
    .from(labels)
    .where(
      and(
        isNull(labels.deletedAt),
        or(isNull(labels.projectId), eq(labels.projectId, projectId)),
      ),
    )
    .orderBy(asc(labels.name), asc(labels.id))
    .all();
}

/**
 * Lookup rule: a label name is resolved case-insensitively against the
 * issue's project labels first, then global labels. A project label therefore
 * shadows a global label of the same name for issues of that project (the two
 * may coexist because uniqueness is per scope); issues of other projects
 * still get the global one.
 *
 * Resolves every name before anything is written. An unknown name fails with
 * a `validation_error` listing the labels available for that project; names
 * are never auto-created.
 */
function resolveLabelNames(
  db: DbHandle,
  projectId: string,
  names: string[],
): Label[] {
  const available = labelsAvailableTo(db, projectId);
  const resolved = new Map<string, Label>();
  for (const name of names) {
    const wanted = lowerName(name);
    const matches = available.filter((l) => lowerName(l.name) === wanted);
    const label =
      matches.find((l) => l.projectId === projectId) ??
      matches.find((l) => l.projectId === null);
    if (!label) {
      const existing = [...new Set(available.map((l) => l.name))];
      throw new ServiceError(
        "validation_error",
        `Unknown label '${name}'. ${
          existing.length
            ? `Existing labels: ${existing.join(", ")}.`
            : "No labels exist yet."
        } Use save_issue_label to create one.`,
        { label: name, existing },
      );
    }
    resolved.set(label.id, label);
  }
  return [...resolved.values()];
}

function liveIssue(db: DbHandle, issueId: string) {
  const issue = db
    .select()
    .from(issues)
    .where(and(eq(issues.id, issueId), isNull(issues.deletedAt)))
    .get();
  if (!issue)
    throw new ServiceError("not_found", `Issue "${issueId}" not found`);
  return issue;
}

function attachedLabelIds(db: DbHandle, issueId: string): Set<string> {
  return new Set(
    db
      .select({ id: issueLabels.labelId })
      .from(issueLabels)
      .where(eq(issueLabels.issueId, issueId))
      .all()
      .map((r) => r.id),
  );
}

function writeActivity(
  tx: Tx,
  actor: Actor,
  issueId: string,
  type: "label_added" | "label_removed",
  label: Label,
) {
  tx.insert(activity)
    .values({
      id: newId(),
      issueId,
      actor,
      type,
      data: JSON.stringify({ label: label.name }),
      createdAt: nowIso(),
    })
    .run();
}

/**
 * Adds labels (by name) to an issue. Idempotent; writes one `label_added`
 * activity row per label actually added. All-or-nothing: an unknown name
 * throws before anything is attached. Runs in the caller's transaction so the
 * issue update path can include it. Returns the labels newly attached.
 */
export function attachLabels(
  tx: Tx,
  actor: Actor,
  issueId: string,
  names: string[],
): Label[] {
  const issue = liveIssue(tx, issueId);
  const wanted = resolveLabelNames(
    tx,
    issue.projectId,
    parseInput(labelNamesSchema, names),
  );
  const attached = attachedLabelIds(tx, issueId);
  const added = wanted.filter((l) => !attached.has(l.id));
  for (const label of added) {
    tx.insert(issueLabels).values({ issueId, labelId: label.id }).run();
    writeActivity(tx, actor, issueId, "label_added", label);
  }
  return added;
}

/**
 * Removes labels (by name) from an issue. Idempotent; writes one
 * `label_removed` row per label actually removed. Unknown names are an error
 * like in `attachLabels`. Returns the labels removed.
 */
export function detachLabels(
  tx: Tx,
  actor: Actor,
  issueId: string,
  names: string[],
): Label[] {
  const issue = liveIssue(tx, issueId);
  const attached = attachedLabelIds(tx, issueId);
  // A label soft-deleted while attached is no longer resolvable by name, yet
  // the link row is still there; match those first so they can be detached.
  const stale = attached.size
    ? tx
        .select()
        .from(labels)
        .where(
          and(inArray(labels.id, [...attached]), isNotNull(labels.deletedAt)),
        )
        .all()
    : [];
  const parsed = parseInput(labelNamesSchema, names);
  const staleMatches = new Map<string, Label>();
  const rest: string[] = [];
  const available = labelsAvailableTo(tx, issue.projectId);
  for (const name of parsed) {
    // A live label of that name that is attached wins; otherwise the stale one
    // is what the caller means (a same-named live label may exist unattached).
    const liveAttached = available.some(
      (l) => lowerName(l.name) === lowerName(name) && attached.has(l.id),
    );
    const hit = liveAttached
      ? undefined
      : stale.find((l) => lowerName(l.name) === lowerName(name));
    if (hit) staleMatches.set(hit.id, hit);
    else rest.push(name);
  }
  const wanted = [
    ...staleMatches.values(),
    ...(rest.length ? resolveLabelNames(tx, issue.projectId, rest) : []),
  ];
  const removed = wanted.filter((l) => attached.has(l.id));
  for (const label of removed) {
    tx.delete(issueLabels)
      .where(
        and(
          eq(issueLabels.issueId, issueId),
          eq(issueLabels.labelId, label.id),
        ),
      )
      .run();
    writeActivity(tx, actor, issueId, "label_removed", label);
  }
  return removed;
}

/**
 * Makes the issue's label set exactly `names` (the `save_issue` semantics),
 * adding and removing only the difference. Labels that were soft-deleted
 * while attached are not part of the set and are left untouched.
 */
export function setIssueLabels(
  tx: Tx,
  actor: Actor,
  issueId: string,
  names: string[],
): { added: Label[]; removed: Label[] } {
  const issue = liveIssue(tx, issueId);
  const wanted = resolveLabelNames(
    tx,
    issue.projectId,
    parseInput(labelNamesSchema, names),
  );
  const wantedIds = new Set(wanted.map((l) => l.id));
  const attachedIds = attachedLabelIds(tx, issueId);
  const current = attachedIds.size
    ? tx
        .select()
        .from(labels)
        .where(
          and(inArray(labels.id, [...attachedIds]), isNull(labels.deletedAt)),
        )
        .all()
    : [];
  const added = wanted.filter((l) => !attachedIds.has(l.id));
  const removed = current.filter((l) => !wantedIds.has(l.id));
  for (const label of removed) {
    tx.delete(issueLabels)
      .where(
        and(
          eq(issueLabels.issueId, issueId),
          eq(issueLabels.labelId, label.id),
        ),
      )
      .run();
    writeActivity(tx, actor, issueId, "label_removed", label);
  }
  for (const label of added) {
    tx.insert(issueLabels).values({ issueId, labelId: label.id }).run();
    writeActivity(tx, actor, issueId, "label_added", label);
  }
  return { added, removed };
}

/** Live labels currently attached to an issue, by name. */
export function listIssueLabels(db: DbHandle, issueId: string): Label[] {
  return db
    .select({ label: labels })
    .from(issueLabels)
    .innerJoin(labels, eq(labels.id, issueLabels.labelId))
    .where(and(eq(issueLabels.issueId, issueId), isNull(labels.deletedAt)))
    .orderBy(asc(labels.name), asc(labels.id))
    .all()
    .map((r) => r.label);
}

export function createLabelsService(ctx: ServiceContext) {
  return {
    /** Labels carry no `created_by` column, so there is no actor to stamp. */
    create(input: CreateLabelInput): Label {
      const data = parseInput(createLabelInputSchema, input);
      return ctx.write((tx) => {
        const projectId = data.project
          ? resolveProject(tx, data.project).id
          : null;
        assertNameFree(tx, projectId, data.name);
        return tx
          .insert(labels)
          .values({
            id: newId(),
            name: data.name,
            ...(data.color ? { color: data.color } : {}),
            projectId,
            createdAt: nowIso(),
          })
          .returning()
          .get();
      });
    },

    get(id: string): Label {
      return getLabel(ctx.db, id);
    },

    update(id: string, input: UpdateLabelInput): Label {
      const patch = parseInput(updateLabelInputSchema, input);
      if (Object.values(patch).every((v) => v === undefined)) {
        throw new ServiceError("validation_error", "No fields to update");
      }
      return ctx.write((tx) => {
        const label = getLabel(tx, id);
        if (patch.name !== undefined) {
          assertNameFree(tx, label.projectId, patch.name, label.id);
        }
        return tx
          .update(labels)
          .set(definedOnly(patch))
          .where(eq(labels.id, label.id))
          .returning()
          .get();
      });
    },

    /** Soft delete. Existing issue attachments are kept; deleted labels are hidden from issues. */
    delete(id: string): Label {
      return ctx.write((tx) => {
        const label = getLabel(tx, id);
        return tx
          .update(labels)
          .set({ deletedAt: nowIso() })
          .where(eq(labels.id, label.id))
          .returning()
          .get();
      });
    },

    /** Global labels, plus `project`'s labels when given; by name. */
    list(input: ListLabelsInput = {}): (Label & { deleted?: boolean })[] {
      const { project, includeDeleted } = parseInput(
        listLabelsInputSchema,
        input,
      );
      const projectId = project
        ? resolveProject(ctx.db, project, { includeDeleted }).id
        : undefined;
      const rows = ctx.db
        .select()
        .from(labels)
        .where(
          and(
            projectId
              ? or(isNull(labels.projectId), eq(labels.projectId, projectId))
              : isNull(labels.projectId),
            includeDeleted ? undefined : isNull(labels.deletedAt),
          ),
        )
        .orderBy(asc(labels.name), asc(labels.id))
        .all();
      return flagDeleted(rows, includeDeleted);
    },

    attach: (actor: Actor, issueId: string, names: string[]) =>
      ctx.write((tx) => attachLabels(tx, actor, issueId, names)),
    detach: (actor: Actor, issueId: string, names: string[]) =>
      ctx.write((tx) => detachLabels(tx, actor, issueId, names)),
    setForIssue: (actor: Actor, issueId: string, names: string[]) =>
      ctx.write((tx) => setIssueLabels(tx, actor, issueId, names)),
    listForIssue: (issueId: string) => listIssueLabels(ctx.db, issueId),
  };
}

export type LabelsService = ReturnType<typeof createLabelsService>;
