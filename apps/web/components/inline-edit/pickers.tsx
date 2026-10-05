"use client";
import { Check, Tag } from "lucide-react";
import type { ReactNode } from "react";
import { PRIORITY_OPTIONS } from "@/components/issue-detail/atoms";
import { LabelChip } from "@/components/issues-table/label-chip";
import { PriorityIcon } from "@/components/issues-table/priority";
import { ActorAvatar, STATUS_LABEL, StatusIcon } from "@/components/traccia/atoms";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { IssueRow, Label } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";
import { ISSUE_STATUSES, type Priority } from "@traccia/shared";
import type { Edit } from "./use-inline-edit";

/** What the pickers need besides the issue: how to save, and which labels exist. */
export type InlineEditor = { edit: Edit; labels: Label[] };

const trigger = "inline-flex items-center gap-1 rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring";
const Tick = ({ on }: { on: boolean }) => (on ? <Check className="ml-auto size-3.5 text-primary" /> : null);

/**
 * Wraps a trigger so that neither its key presses nor the (portaled) menu's reach a parent: on a board card
 * the sortable wrapper would otherwise start a keyboard drag from Space/Enter.
 */
function Isolated({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("relative z-[1] inline-flex", className)} onKeyDown={(e) => e.stopPropagation()}>{children}</span>;
}

function Picker({ label, triggerClass, trigger: shown, children, className }: { label: string; triggerClass?: string; trigger: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Isolated className={className}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={label} className={cn(trigger, triggerClass)}>{shown}</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">{children}</DropdownMenuContent>
      </DropdownMenu>
    </Isolated>
  );
}

export function StatusPicker({ issue, editor, className }: { issue: IssueRow; editor: InlineEditor; className?: string }) {
  return (
    <Picker label={`Change status of ${issue.identifier}`} triggerClass="p-0.5" className={className} trigger={<StatusIcon status={issue.status} />}>
      {ISSUE_STATUSES.map((s) => (
        <DropdownMenuItem key={s} onSelect={() => s !== issue.status && editor.edit(issue, `status to ${STATUS_LABEL[s]}`, () => ({ status: s }), { status: s })}>
          <StatusIcon status={s} />{STATUS_LABEL[s]}<Tick on={s === issue.status} />
        </DropdownMenuItem>
      ))}
    </Picker>
  );
}

export function PriorityPicker({ issue, editor, className }: { issue: IssueRow; editor: InlineEditor; className?: string }) {
  return (
    <Picker label={`Change priority of ${issue.identifier}`} triggerClass="p-0.5" className={className} trigger={<PriorityIcon priority={issue.priority as Priority} />}>
      {PRIORITY_OPTIONS.map((p) => (
        <DropdownMenuItem key={p.value} onSelect={() => p.value !== issue.priority && editor.edit(issue, `priority to ${p.label}`, () => ({ priority: p.value }), { priority: p.value })}>
          <PriorityIcon priority={p.value as Priority} />{p.label}<Tick on={p.value === issue.priority} />
        </DropdownMenuItem>
      ))}
    </Picker>
  );
}

export function AssigneePicker({ issue, editor, size = 18, className }: { issue: IssueRow; editor: InlineEditor; size?: number; className?: string }) {
  return (
    <Picker label={`Change assignee of ${issue.identifier}`} triggerClass="rounded-full p-0.5" className={className} trigger={<ActorAvatar who={issue.assignee} size={size} />}>
      {([[null, "Unassigned"], ["you", "You"], ["agent", "Agent"]] as const).map(([v, text]) => (
        <DropdownMenuItem key={text} onSelect={() => v !== issue.assignee && editor.edit(issue, `assignee to ${text}`, () => ({ assignee: v }), { assignee: v })}>
          <ActorAvatar who={v} size={16} />{text}<Tick on={v === issue.assignee} />
        </DropdownMenuItem>
      ))}
    </Picker>
  );
}

/** Global labels plus the ones of the issue's own project. */
export const labelsFor = (issue: IssueRow, labels: Label[]) => labels.filter((l) => l.projectId === null || l.projectId === issue.projectId);

export function LabelsPicker({ issue, editor, visible = 2, className }: { issue: IssueRow; editor: InlineEditor; visible?: number; className?: string }) {
  const options = labelsFor(issue, editor.labels);
  const names = issue.labels.map((l) => l.name);
  return (
    <Picker
      label={`Change labels of ${issue.identifier}`}
      triggerClass="min-h-5 gap-1 px-0.5"
      className={className}
      trigger={issue.labels.length ? (
        <>
          {issue.labels.slice(0, visible).map((l) => <LabelChip key={l.id} name={l.name} color={l.color} />)}
          {issue.labels.length > visible && <span className="text-[11px] text-muted-foreground">+{issue.labels.length - visible}</span>}
        </>
      ) : <Tag className="size-3.5 text-muted-foreground/50" />}
    >
      {options.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No labels yet.</div>}
      {options.map((l) => {
        // Toggle against the latest labels, so a re-apply after a conflict keeps others' changes.
        const toggle = (cur: string[]) => (cur.includes(l.name) ? cur.filter((x) => x !== l.name) : [...cur, l.name]);
        return (
          <DropdownMenuItem
            key={l.id}
            onSelect={(e) => {
              e.preventDefault();
              editor.edit(issue, `label ${l.name}`, (cur) => ({ labels: toggle(cur.labels.map((x) => x.name)) }), {
                labels: toggle(names).map((n) => editor.labels.find((x) => x.name === n)).filter((x): x is Label => x !== undefined),
              });
            }}
          >
            <span className="size-2 rounded-full" style={{ background: l.color }} />{l.name}<Tick on={names.includes(l.name)} />
          </DropdownMenuItem>
        );
      })}
    </Picker>
  );
}
