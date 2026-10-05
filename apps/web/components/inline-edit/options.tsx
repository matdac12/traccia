import type { ReactNode } from "react";
import { PRIORITY_OPTIONS } from "@/components/issue-detail/atoms";
import { PriorityIcon } from "@/components/issues-table/priority";
import { ActorAvatar, STATUS_LABEL, StatusIcon } from "@/components/traccia/atoms";
import type { IssueRow, Label } from "@/lib/api/schemas";
import { ISSUE_STATUSES, type Priority } from "@traccia/shared";
import type { Edit } from "./use-inline-edit";

/** What the pickers need besides the issue: how to save, and which labels exist. */
export type InlineEditor = { edit: Edit; labels: Label[] };

/** One choice of a picker, independent of the menu primitive that shows it (dropdown or context menu, MAT-1762). */
export type PickOption = { key: string; text: string; icon: ReactNode; checked: boolean; onSelect: (e: Event) => void; keepOpen?: boolean };

/** Global labels plus the ones of the issue's own project. */
export const labelsFor = (issue: IssueRow, labels: Label[]) => labels.filter((l) => l.projectId === null || l.projectId === issue.projectId);

export function statusOptions(issue: IssueRow, editor: InlineEditor): PickOption[] {
  return ISSUE_STATUSES.map((s) => ({
    key: s, text: STATUS_LABEL[s], icon: <StatusIcon status={s} />, checked: s === issue.status,
    onSelect: () => { if (s !== issue.status) editor.edit(issue, `status to ${STATUS_LABEL[s]}`, () => ({ status: s }), { status: s }); },
  }));
}

export function priorityOptions(issue: IssueRow, editor: InlineEditor): PickOption[] {
  return PRIORITY_OPTIONS.map((p) => ({
    key: String(p.value), text: p.label, icon: <PriorityIcon priority={p.value as Priority} />, checked: p.value === issue.priority,
    onSelect: () => { if (p.value !== issue.priority) editor.edit(issue, `priority to ${p.label}`, () => ({ priority: p.value }), { priority: p.value }); },
  }));
}

export function assigneeOptions(issue: IssueRow, editor: InlineEditor): PickOption[] {
  return ([[null, "Unassigned"], ["you", "You"], ["agent", "Agent"]] as const).map(([v, text]) => ({
    key: text, text, icon: <ActorAvatar who={v} size={16} />, checked: v === issue.assignee,
    onSelect: () => { if (v !== issue.assignee) editor.edit(issue, `assignee to ${text}`, () => ({ assignee: v }), { assignee: v }); },
  }));
}

export function labelOptions(issue: IssueRow, editor: InlineEditor): PickOption[] {
  const names = issue.labels.map((l) => l.name);
  return labelsFor(issue, editor.labels).map((l) => {
    // Toggle against the latest labels, so a re-apply after a conflict keeps others' changes.
    const toggle = (cur: string[]) => (cur.includes(l.name) ? cur.filter((x) => x !== l.name) : [...cur, l.name]);
    return {
      key: l.id, text: l.name, icon: <span className="size-2 rounded-full" style={{ background: l.color }} />, checked: names.includes(l.name), keepOpen: true,
      onSelect: () => editor.edit(issue, `label ${l.name}`, (cur) => ({ labels: toggle(cur.labels.map((x) => x.name)) }), {
        labels: toggle(names).map((n) => editor.labels.find((x) => x.name === n)).filter((x): x is Label => x !== undefined),
      }),
    };
  });
}
