/** Optional list metadata; the parent owns visibility and any persistence. */
export type IssueColumns = { milestone: boolean; assignee: boolean; estimate: boolean; updatedAt: boolean };

export const DEFAULT_ISSUE_COLUMNS: IssueColumns = { milestone: true, assignee: true, estimate: true, updatedAt: true };

export const COLUMN_LABEL: Record<keyof IssueColumns, string> = { milestone: "Milestone", assignee: "Assignee", estimate: "Estimate", updatedAt: "Updated" };
