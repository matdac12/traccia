export const ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** 0 none, 1 urgent, 2 high, 3 medium, 4 low (same as Linear). */
export const PRIORITIES = [0, 1, 2, 3, 4] as const;
export type Priority = (typeof PRIORITIES)[number];

export const ACTORS = ["agent", "you"] as const;
export type Actor = (typeof ACTORS)[number];

export const PROJECT_STATUSES = [
  "active",
  "paused",
  "completed",
  "canceled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ACTIVITY_TYPES = [
  "issue_created",
  "title_changed",
  "description_changed",
  "status_changed",
  "priority_changed",
  "estimate_changed",
  "assignee_changed",
  "milestone_changed",
  "project_changed",
  "parent_changed",
  "label_added",
  "label_removed",
  "blocker_added",
  "blocker_removed",
  "comment_added",
  "comment_deleted",
  "comment_restored",
  "attachment_added",
  "attachment_deleted",
  "attachment_restored",
  "issue_deleted",
  "issue_restored",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
