import type { Actor, IssueStatus } from "@linear-matti/shared";
import { STATUS_LABEL } from "@/components/traccia/atoms";
import type { ActivityRow } from "@/lib/api/schemas";

const PRIORITY = ["No priority", "Urgent", "High", "Medium", "Low"];

export type ActivityLookups = {
  /** Display names for ids stored in activity data (milestones, projects, parent issues). */
  milestone?: (id: string) => string | undefined;
  project?: (id: string) => string | undefined;
};

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const quote = (v: unknown) => `“${str(v) ?? "?"}”`;
const actorName = (v: unknown) => (v === "you" ? "You" : v === "agent" ? "an agent" : "nobody");

/** One line of timeline text for an activity row, e.g. `changed status from Todo to Done`. */
export function describeActivity(row: Pick<ActivityRow, "type" | "data">, lookups: ActivityLookups = {}): string {
  const d = row.data;
  const named = (id: unknown, lookup?: (id: string) => string | undefined) => {
    const s = str(id);
    return s ? (lookup?.(s) ?? "another one") : "none";
  };
  switch (row.type) {
    case "issue_created":
      return "created the issue";
    case "title_changed":
      return `renamed the issue from ${quote(d.from)} to ${quote(d.to)}`;
    case "description_changed":
      return "edited the description";
    case "status_changed":
      return `changed status from ${STATUS_LABEL[d.from as IssueStatus] ?? "?"} to ${STATUS_LABEL[d.to as IssueStatus] ?? "?"}`;
    case "priority_changed":
      return `changed priority from ${PRIORITY[num(d.from) ?? -1] ?? "?"} to ${PRIORITY[num(d.to) ?? -1] ?? "?"}`;
    case "estimate_changed":
      return `changed estimate from ${num(d.from) ?? "none"} to ${num(d.to) ?? "none"}`;
    case "assignee_changed":
      return `changed assignee from ${actorName(d.from)} to ${actorName(d.to)}`;
    case "milestone_changed":
      return `changed milestone from ${named(d.from, lookups.milestone)} to ${named(d.to, lookups.milestone)}`;
    case "project_changed":
      return `moved the issue from ${named(d.from, lookups.project)} to ${named(d.to, lookups.project)}`;
    case "parent_changed":
      return str(d.to) ? "changed the parent issue" : "made this a top-level issue";
    case "label_added":
      return `added label ${str(d.label) ?? "?"}`;
    case "label_removed":
      return `removed label ${str(d.label) ?? "?"}`;
    case "blocker_added":
      return `marked ${str(d.blocker) ?? "?"} as blocking ${str(d.blocked) ?? "?"}`;
    case "blocker_removed":
      return `removed the block of ${str(d.blocker) ?? "?"} on ${str(d.blocked) ?? "?"}`;
    case "comment_added":
      return d.parentId ? "replied to a comment" : "commented";
    case "comment_deleted":
      return "deleted a comment";
    case "comment_restored":
      return "restored a comment";
    case "attachment_added":
      return `attached ${str(d.filename) ?? "a file"}`;
    case "attachment_deleted":
      return "removed an attachment";
    case "attachment_restored":
      return "restored an attachment";
    case "issue_deleted":
      return "moved the issue to Trash";
    case "issue_restored":
      return "restored the issue";
  }
}

export function actorLabel(actor: Actor): string {
  return actor === "you" ? "You" : "Agent";
}
