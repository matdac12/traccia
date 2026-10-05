import type { RestoreResult, TrashItem, TrashType } from "@/lib/api/schemas";

/** Pure helpers for the Trash view (no React, no server imports) so they can be unit-tested. */

export const TYPE_LABEL: Record<TrashType, string> = {
  project: "Project",
  milestone: "Milestone",
  issue: "Issue",
  comment: "Comment",
  attachment: "Attachment",
};

const PLURAL: Record<TrashType, [string, string]> = {
  project: ["project", "projects"],
  milestone: ["milestone", "milestones"],
  issue: ["issue", "issues"],
  comment: ["comment", "comments"],
  attachment: ["attachment", "attachments"],
};

export const pluralize = (type: TrashType, n: number) => `${n} ${PLURAL[type][n === 1 ? 0 : 1]}`;

/** "2 comments and 1 attachment" */
function describeCounts(byType: Partial<Record<TrashType, number>>): string {
  const parts = (Object.keys(PLURAL) as TrashType[]).flatMap((t) => (byType[t] ? [pluralize(t, byType[t])] : []));
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The part of a trash label that is the issue identifier ("MAT-12 Fix it" -> "MAT-12"). */
export const issueIdentifier = (label: string) => label.split(" ")[0] ?? label;

/**
 * Other trashed items that go away with `item` when it is purged: the rest of its delete batch
 * plus, for an issue, every trashed comment and attachment that hangs off it.
 */
export function companions(item: TrashItem, all: readonly TrashItem[]): TrashItem[] {
  return all.filter(
    (o) =>
      !(o.type === item.type && o.id === item.id) &&
      ((item.deletedBatch !== null && o.deletedBatch === item.deletedBatch) ||
        (item.type === "issue" && o.issueId === item.id)),
  );
}

export function summarize(items: readonly TrashItem[]): string {
  const byType: Partial<Record<TrashType, number>> = {};
  for (const i of items) byType[i.type] = (byType[i.type] ?? 0) + 1;
  return describeCounts(byType);
}

/** Text of the purge confirmation: names the item, says it cannot be undone, counts what goes with it. */
export function purgeConfirmation(item: TrashItem, all: readonly TrashItem[]) {
  const others = companions(item, all);
  return {
    title: `Purge ${TYPE_LABEL[item.type].toLowerCase()} permanently?`,
    name: item.label,
    warning: "This cannot be undone.",
    withIt: others.length > 0 ? `This also permanently removes ${summarize(others)} deleted with it.` : null,
  };
}

/** What a restore brought back, e.g. "Restored with 3 comments." */
export function restoreSummary(result: RestoreResult): string {
  const { counts, type } = result;
  const extra: Partial<Record<TrashType, number>> = {
    project: counts.projects,
    milestone: counts.milestones,
    issue: counts.issues,
    comment: counts.comments,
    attachment: counts.attachments,
  };
  // The item itself is one of its own type; report everything.
  const total = Object.values(extra).reduce((a, b) => a + (b ?? 0), 0);
  return total > 1 ? `Restored ${describeCounts(extra)}.` : `Restored ${type}.`;
}

/** Where to open an item (restored or not). Comments and attachments open their issue. */
export function itemHref(item: Pick<TrashItem, "type" | "id" | "label" | "issueId">): string | null {
  switch (item.type) {
    case "issue":
      return `/issues/${encodeURIComponent(issueIdentifier(item.label))}`;
    case "project":
      return `/projects/${encodeURIComponent(item.id)}`;
    case "comment":
    case "attachment":
      return item.issueId ? `/issues/${encodeURIComponent(item.issueId)}` : null;
    case "milestone":
      return null;
  }
}

export type ActionError = { ok: false; code: string; message: string };

/** Human text for an API failure. The API's own message is kept; known codes get context. */
export function errorText(code: string, message: string, verb: "restore" | "purge"): string {
  switch (code) {
    case "forbidden":
      return verb === "purge" ? "Purge is not allowed for this token." : `You are not allowed to ${verb} this item.`;
    case "not_found":
      return "This item no longer exists. Reload to refresh the list.";
    case "conflict":
      return message;
    case "unreachable":
      return "The API is unreachable. Try again in a moment.";
    default:
      return message || `Could not ${verb} this item.`;
  }
}
