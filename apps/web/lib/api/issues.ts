import "server-only";
import { ISSUE_STATUSES, type IssueStatus } from "@linear-matti/shared";
import { filtersToApiQuery, type IssueFilters } from "../issue-filters";
import type { z } from "zod";
import { api } from "./client";
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

async function listAll<T extends z.ZodType>(path: string, item: T) {
  const items: z.output<T>[] = [];
  let cursor: string | undefined;
  do {
    const page = await api().request(path, { schema: pageOf(item), query: { limit: 250, cursor } });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

export const listLabels = () => listAll("/labels", labelSchema);

export const listProjectMilestones = (projectId: string) =>
  listAll(`/projects/${encodeURIComponent(projectId)}/milestones`, milestoneSchema);
