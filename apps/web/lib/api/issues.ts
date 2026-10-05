import "server-only";
import { ISSUE_STATUSES, type IssueStatus } from "@linear-matti/shared";
import { filtersToApiQuery, type IssueFilters } from "../issue-filters";
import type { CreateIssueInput } from "@linear-matti/shared";
import { z } from "zod";
import { ApiError, api } from "./client";
import { issueDetailSchema, issueRefSchema, issueSchema, labelSchema, milestoneSchema, pageOf, restoreResultSchema, searchHitSchema } from "./schemas";

/** Issues per status group per request: the table never loads the whole list. */
export const GROUP_PAGE_SIZE = 50;

export function listIssuePage(filters: IssueFilters, status: IssueStatus, cursor?: string) {
  return api().request("/issues", {
    schema: pageOf(issueSchema),
    query: { ...filtersToApiQuery(filters), status: [status], limit: GROUP_PAGE_SIZE, cursor },
  });
}

/** The first page of every status group, fetched in parallel. */
export async function listIssueGroups(filters: IssueFilters) {
  return Promise.all(
    ISSUE_STATUSES.map(async (status) => ({ status, ...(await listIssuePage(filters, status)) })),
  );
}

/** Pages fetched at most per group on a refresh: 5 x 50 covers everything "load more" can reasonably have opened. */
const MAX_REFRESH_PAGES = 5;

/**
 * A refresh of the groups already on screen: for every status it re-reads as many pages as the client had
 * loaded (`counts`), so a poll never drops what "load more" opened. `board` lists by Kanban position.
 */
export async function refreshIssueGroups(filters: IssueFilters, counts: Partial<Record<IssueStatus, number>>, board: boolean) {
  const page = board ? listBoardPage : listIssuePage;
  return Promise.all(
    ISSUE_STATUSES.map(async (status) => {
      const items: z.output<typeof issueSchema>[] = [];
      let cursor: string | undefined;
      let nextCursor: string | null = null;
      for (let i = 0; i < MAX_REFRESH_PAGES; i++) {
        const res = await page(filters, status, cursor);
        items.push(...res.items);
        nextCursor = res.nextCursor;
        cursor = res.nextCursor ?? undefined;
        if (!cursor || items.length >= (counts[status] ?? 0)) break;
      }
      return { status, items, nextCursor };
    }),
  );
}

/**
 * Where a page's live refresh starts: the newest change now, or the epoch on an empty database (so the very
 * first issue created is noticed). Null only when the probe itself failed; the poll then starts from a baseline.
 */
export const initialSyncToken = () => latestIssueChange().then((t) => t ?? "1970-01-01T00:00:00.000Z", () => null);

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

// ---- Issue detail (MAT-1721) ----

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

/** The board shows each column in `sortOrder` (Kanban position), whatever sort the table uses. */
const boardFilters = (f: IssueFilters): IssueFilters => ({ ...f, orderBy: "sortOrder", order: "asc" });

export const listBoardPage = (filters: IssueFilters, status: IssueStatus, cursor?: string) =>
  listIssuePage(boardFilters(filters), status, cursor);

export const listBoardColumns = (filters: IssueFilters) => listIssueGroups(boardFilters(filters));

/** `PATCH /issues/:identifier/position`: neighbour ids only, the service computes the position. */
export function moveIssue(identifier: string, body: { status: IssueStatus; beforeId?: string; afterId?: string }) {
  return api().request(`/issues/${encodeURIComponent(identifier)}/position`, { method: "PATCH", schema: issueSchema, body });
}
