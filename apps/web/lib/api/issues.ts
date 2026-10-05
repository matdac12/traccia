import "server-only";
import { ISSUE_STATUSES, type IssueStatus } from "@linear-matti/shared";
import { filtersToApiQuery, type IssueFilters } from "../issue-filters";
import type { CreateIssueInput } from "@linear-matti/shared";
import type { z } from "zod";
import { ApiError, api } from "./client";
import { issueSchema, labelSchema, milestoneSchema, pageOf } from "./schemas";

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
