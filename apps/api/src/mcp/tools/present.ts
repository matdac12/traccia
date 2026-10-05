import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../../db/connection.js";
import {
  attachments,
  issueLabels,
  issues,
  labels,
  milestones,
  projects,
} from "../../db/schema.js";
import type { Attachment } from "../../service/attachments.js";
import type { Comment } from "../../service/comments.js";
import type { Issue } from "../../service/issues.js";

/** Drops null, undefined, empty strings and empty arrays (spec: omit empty fields). */
export function compactObject<T extends Record<string, unknown>>(
  obj: T,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(
      ([, v]) =>
        v !== null &&
        v !== undefined &&
        v !== "" &&
        !(Array.isArray(v) && v.length === 0),
    ),
  );
}

const SNIPPET_CHARS = 160;

/** First line-collapsed chunk of a description, for list views. */
export function descriptionSnippet(description: string): string {
  const flat = description.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_CHARS
    ? `${flat.slice(0, SNIPPET_CHARS).trimEnd()}…`
    : flat;
}

/** Human-readable references for a batch of issues, loaded with a handful of queries. */
export function loadRefs(db: Db, rows: Issue[]) {
  const ids = rows.map((r) => r.id);
  const labelNames = new Map<string, string[]>();
  if (ids.length) {
    const attached = db
      .select({ issueId: issueLabels.issueId, name: labels.name })
      .from(issueLabels)
      .innerJoin(labels, eq(labels.id, issueLabels.labelId))
      .where(and(inArray(issueLabels.issueId, ids), isNull(labels.deletedAt)))
      .orderBy(labels.name)
      .all();
    for (const a of attached) {
      labelNames.set(a.issueId, [...(labelNames.get(a.issueId) ?? []), a.name]);
    }
  }
  const milestoneIds = [
    ...new Set(rows.flatMap((r) => (r.milestoneId ? [r.milestoneId] : []))),
  ];
  const milestoneNames = new Map(
    milestoneIds.length
      ? db
          .select({ id: milestones.id, name: milestones.name })
          .from(milestones)
          .where(inArray(milestones.id, milestoneIds))
          .all()
          .map((m) => [m.id, m.name])
      : [],
  );
  const parentIds = [
    ...new Set(rows.flatMap((r) => (r.parentId ? [r.parentId] : []))),
  ];
  const parentIdentifiers = new Map(
    parentIds.length
      ? db
          .select({ id: issues.id, identifier: issues.identifier })
          .from(issues)
          .where(inArray(issues.id, parentIds))
          .all()
          .map((p) => [p.id, p.identifier])
      : [],
  );
  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const projectKeys = new Map(
    projectIds.length
      ? db
          .select({ id: projects.id, key: projects.key })
          .from(projects)
          .where(inArray(projects.id, projectIds))
          .all()
          .map((p) => [p.id, p.key])
      : [],
  );
  return { labelNames, milestoneNames, parentIdentifiers, projectKeys };
}

type Refs = ReturnType<typeof loadRefs>;

/** The compact list-item shape from spec A.3. */
export function compactIssue(issue: Issue, refs: Refs) {
  return compactObject({
    identifier: issue.identifier,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    assignee: issue.assignee,
    labels: refs.labelNames.get(issue.id),
    project: refs.projectKeys.get(issue.projectId),
    milestone: issue.milestoneId
      ? refs.milestoneNames.get(issue.milestoneId)
      : null,
    parent: issue.parentId ? refs.parentIdentifiers.get(issue.parentId) : null,
    estimate: issue.estimate,
    updatedAt: issue.updatedAt,
    descriptionSnippet: descriptionSnippet(issue.description),
    deleted: issue.deletedAt ? true : undefined,
  });
}

export function compactIssues(db: Db, rows: Issue[]) {
  const refs = loadRefs(db, rows);
  return rows.map((r) => compactIssue(r, refs));
}

export function presentAttachment(a: Attachment) {
  return compactObject({
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    commentId: a.commentId,
    createdAt: a.createdAt,
  });
}

export function presentComment(c: Comment, commentAttachments: Attachment[]) {
  return compactObject({
    id: c.id,
    body: c.body,
    actor: c.actor,
    parentId: c.parentId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    attachments: commentAttachments.map(presentAttachment),
    deleted: c.deletedAt ? true : undefined,
  });
}

/** Live attachments grouped by the comment they hang off. */
export function attachmentsByComment(db: Db, issueId: string) {
  const rows = db
    .select()
    .from(attachments)
    .where(and(eq(attachments.issueId, issueId), isNull(attachments.deletedAt)))
    .orderBy(attachments.createdAt, attachments.id)
    .all();
  const byComment = new Map<string, Attachment[]>();
  for (const { storageKey: _k, ...a } of rows) {
    if (!a.commentId) continue;
    byComment.set(a.commentId, [...(byComment.get(a.commentId) ?? []), a]);
  }
  return byComment;
}
