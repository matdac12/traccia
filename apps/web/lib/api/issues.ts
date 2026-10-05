import "server-only";
import { z } from "zod";
import { api } from "./client";
import {
  issueDetailSchema,
  issueRefSchema,
  issueSchema,
  labelSchema,
  milestoneSchema,
  pageOf,
  searchHitSchema,
} from "./schemas";

const DETAIL_INCLUDES = ["comments", "activity", "attachments", "children", "relations"];

/** The issue with everything the detail page shows. `identifier` may also be an issue id. */
export function getIssueDetail(identifier: string) {
  return api().request(`/issues/${encodeURIComponent(identifier)}`, {
    schema: issueDetailSchema,
    query: { include: DETAIL_INCLUDES },
  });
}

/** The bare issue (no includes), e.g. for a parent's title. */
export function getIssue(identifier: string) {
  return api().request(`/issues/${encodeURIComponent(identifier)}`, { schema: issueSchema });
}

/** `PATCH /issues/:identifier`. `ifMatch` is the issue's last seen `updatedAt`; a stale one is a 409. */
export function patchIssue(identifier: string, body: Record<string, unknown>, ifMatch?: string) {
  return api().request(`/issues/${encodeURIComponent(identifier)}`, { schema: issueSchema, method: "PATCH", body, ifMatch });
}

export function createIssue(body: Record<string, unknown>) {
  return api().request("/issues", { schema: issueSchema, method: "POST", body });
}

const deletedSchema = z.object({ type: z.string(), id: z.string() }).passthrough();

/** Soft delete. The result's batch restores it. */
export function deleteIssue(identifier: string) {
  return api().request(`/issues/${encodeURIComponent(identifier)}`, { schema: deletedSchema, method: "DELETE" });
}

export function restoreIssue(identifier: string) {
  return api().request(`/issues/${encodeURIComponent(identifier)}/restore`, { schema: deletedSchema, method: "POST" });
}

async function listAll<S extends z.ZodType>(path: string, schema: S, query: Record<string, string> = {}) {
  const items: z.output<S>[] = [];
  let cursor: string | undefined;
  do {
    const page = await api().request(path, { schema: pageOf(schema), query: { ...query, limit: 250, cursor } });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

/** Labels an issue of this project can carry: the global ones plus the project's own. */
export function listLabelOptions(projectKey: string) {
  return listAll("/labels", labelSchema, { project: projectKey });
}

export function listMilestoneOptions(projectKey: string) {
  return listAll(`/projects/${encodeURIComponent(projectKey)}/milestones`, milestoneSchema);
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/**
 * Issues to pick as a blocker or parent. An identifier (`MAT-12`) is looked up directly; anything
 * else is a full-word search (the API's search has no prefix matching).
 */
export async function findIssues(query: string, limit = 8) {
  const q = query.trim();
  if (!q) return [];
  if (IDENTIFIER.test(q)) {
    try {
      const issue = await api().request(`/issues/${encodeURIComponent(q.toUpperCase())}`, { schema: issueRefSchema });
      return [issue];
    } catch (err) {
      if ((err as { status?: number }).status === 404) return [];
      throw err;
    }
  }
  const hits = await api().request("/search", { schema: pageOf(searchHitSchema), query: { q: toFtsQuery(q), limit } });
  const out = [];
  for (const hit of hits.items) {
    const issue = await api().request(`/issues/${encodeURIComponent(hit.identifier)}`, { schema: issueRefSchema });
    out.push(issue);
  }
  return out;
}

/** Plain words only: quotes and operators typed by the user must not reach the FTS parser. */
export function toFtsQuery(q: string) {
  return q
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => `"${w}"`)
    .join(" ");
}
