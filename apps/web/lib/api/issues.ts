import "server-only";
import type { CreateIssueInput } from "@linear-matti/shared";
import { ApiError, api } from "./client";
import { issueSchema, pageOf } from "./schemas";

export async function listProjectIssues(project: string, limit = 200) {
  return api().request("/issues", { schema: pageOf(issueSchema), query: { project, limit, orderBy: "updatedAt" } });
}

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
