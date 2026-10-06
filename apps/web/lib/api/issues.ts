import "server-only";
import type { IssueStatus } from "@traccia/shared";
import { filtersToApiQuery, visibleStatuses, type IssueFilters } from "../issue-filters";
import type { CreateIssueInput } from "@traccia/shared";
import { z } from "zod";
import { ApiError, api } from "./client";
import { issueDetailSchema, issueGroupsSchema, issueRefSchema, issueSchema, labelSchema, milestoneSchema, pageOf, restoreResultSchema, searchHitSchema } from "./schemas";

/** Issues per status group per request: the table never loads the whole list. */
export const GROUP_PAGE_SIZE = 50;

export function listIssuePage(filters: IssueFilters, status: IssueStatus, cursor?: string) {
  return api().request("/issues", {
    schema: pageOf(issueSchema),
    query: { ...filtersToApiQuery(filters), status: [status], limit: GROUP_PAGE_SIZE, cursor },
  });
}

type GroupCursors = Partial<Record<IssueStatus, string>>;

/** `GET /issues/groups`: one request for the listed statuses (default: the filters' visible ones), each continuing from its own cursor. */
function fetchGroups(filters: IssueFilters, statuses: readonly IssueStatus[] = visibleStatuses(filters), cursors: GroupCursors = {}) {
  return api().request("/issues/groups", {
    schema: issueGroupsSchema,
    query: {
      ...filtersToApiQuery(filters),
      status: [...statuses],
      limit: GROUP_PAGE_SIZE,
      cursor: statuses.flatMap((s) => (cursors[s] ? [`${s}:${cursors[s]}`] : [])),
    },
  });
}

/**
 * The first page of every status group in one request, with the sync token the live refresh starts from. The
 * API reads the token before the lists, so a change landing in between is picked up by the first poll, never missed.
 */
export const listIssueGroups = (filters: IssueFilters) => fetchGroups(filters);

/** Pages fetched at most per group on a refresh: 5 x 50 covers everything "load more" can reasonably have opened. */
const MAX_REFRESH_PAGES = 5;

/**
 * A refresh of the groups already on screen: for every status it re-reads as many pages as the client had
 * loaded (`counts`), so a poll never drops what "load more" opened. `board` lists by Kanban position.
 * One request in the common case; a group that had "load more" opened continues in follow-up requests that
 * cover all such groups at once.
 */
export async function refreshIssueGroups(filters: IssueFilters, counts: Partial<Record<IssueStatus, number>>, board: boolean) {
  const f = board ? boardFilters(filters) : filters;
  const first = await fetchGroups(f);
  const merged = first.groups.map((g) => ({ ...g, pages: 1 }));
  for (;;) {
    const pending = merged.filter((g) => g.nextCursor && g.items.length < (counts[g.status] ?? 0) && g.pages < MAX_REFRESH_PAGES);
    if (!pending.length) break;
    const next = await fetchGroups(f, pending.map((g) => g.status), Object.fromEntries(pending.map((g) => [g.status, g.nextCursor!])));
    for (const page of next.groups) {
      const group = merged.find((g) => g.status === page.status)!;
      group.items.push(...page.items);
      group.nextCursor = page.nextCursor;
      group.pages++;
    }
  }
  return merged.map(({ status, items, nextCursor }) => ({ status, items, nextCursor }));
}

/**
 * The cheap change probe behind polling: the newest `updatedAt` among issues changed after `since`
 * (soft-deleted ones included, so a delete is noticed too), or null when nothing changed. One row,
 * whatever the board holds. Deliberately unfiltered: a card that moved OUT of a filtered view would
 * otherwise never show up in a filtered probe.
 */
export async function latestIssueChange(since?: string): Promise<string | null> {
  const page = await api().request("/issues", {
    schema: pageOf(issueSchema),
    query: { updatedAfter: since, includeDeleted: true, orderBy: "updatedAt", order: "desc", limit: 1 },
  });
  return page.items[0]?.updatedAt ?? null;
}

async function listAll<T extends z.ZodType>(path: string, item: T, query: Record<string, string | undefined> = {}) {
  const items: z.output<T>[] = [];
  let cursor: string | undefined;
  do {
    const page = await api().request(path, { schema: pageOf(item), query: { ...query, limit: 250, cursor } });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

/** Global labels; with `project`, also that project's own labels. */
export const listLabels = (project?: string) => listAll("/labels", labelSchema, { project });

export const listProjectMilestones = (projectId: string) =>
  listAll(`/projects/${encodeURIComponent(projectId)}/milestones`, milestoneSchema);

/**
 * Creates the issue, then sets its labels (the create route has no `labels` field). If only the
 * label step fails the issue still exists, so that is reported as `labelError` instead of thrown:
 * retrying the whole form would create a duplicate.
 */
export async function createIssue(body: CreateIssueInput, labels: string[]) {
  const created = await api().request("/issues", { schema: issueSchema, method: "POST", body });
  if (!labels.length) return { issue: created, labelError: null };
  try {
    const issue = await api().request(`/issues/${encodeURIComponent(created.identifier)}`, {
      schema: issueSchema,
      method: "PATCH",
      body: { labels },
      ifMatch: created.updatedAt,
    });
    return { issue, labelError: null };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return { issue: created, labelError: err.message };
  }
}

// ---- Issue detail (TRC-47) ----

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

const deletedSchema = z.object({ type: z.string(), id: z.string() }).loose();

/** Soft delete. The result's batch restores it. */
export function deleteIssue(identifier: string) {
  return api().request(`/issues/${encodeURIComponent(identifier)}`, { schema: deletedSchema, method: "DELETE" });
}

export function restoreIssue(identifier: string) {
  return api().request(`/issues/${encodeURIComponent(identifier)}/restore`, { schema: restoreResultSchema, method: "POST" });
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/**
 * Issues to pick as a blocker or parent. An identifier (`MAT-12`) is looked up directly; anything
 * else is a full-text search whose last word may be partial (the API prefix-matches it).
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

/** The board shows each column in `sortOrder` (Kanban position), whatever sort the table uses. */
const boardFilters = (f: IssueFilters): IssueFilters => ({ ...f, orderBy: "sortOrder", order: "asc" });

export const listBoardPage = (filters: IssueFilters, status: IssueStatus, cursor?: string) =>
  listIssuePage(boardFilters(filters), status, cursor);

export const listBoardColumns = (filters: IssueFilters) => listIssueGroups(boardFilters(filters));

/** `PATCH /issues/:identifier/position`: neighbour ids only, the service computes the position. */
export function moveIssue(identifier: string, body: { status: IssueStatus; beforeId?: string; afterId?: string; expectedUpdatedAt?: string }) {
  return api().request(`/issues/${encodeURIComponent(identifier)}/position`, { method: "PATCH", schema: issueSchema, body });
}
