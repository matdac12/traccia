"use client";
import { Check, Tag } from "lucide-react";
import type { ReactNode } from "react";
import { LabelChip } from "@/components/issues-table/label-chip";
import { PriorityIcon } from "@/components/issues-table/priority";
import { ActorAvatar, StatusIcon } from "@/components/traccia/atoms";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { IssueRow } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";
import type { Priority } from "@traccia/shared";
import { assigneeOptions, labelOptions, priorityOptions, statusOptions, type InlineEditor, type PickOption } from "./options";

export type { InlineEditor };

const trigger = "inline-flex items-center gap-1 rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring";
export const Tick = ({ on }: { on: boolean }) => (on ? <Check className="ml-auto size-3.5 text-primary" /> : null);

/**
 * Keeps a trigger's key presses and the (portaled) menu's from reaching a parent: on a board card the sortable
 * wrapper would otherwise start a keyboard drag from Space/Enter. The trigger and the menu content both stop them.
 */
function Isolated({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("relative z-[1] inline-flex", className)}>{children}</span>;
}

function Picker({ label, triggerClass, trigger: shown, children, className }: { label: string; triggerClass?: string; trigger: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Isolated className={className}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={label} onKeyDown={(e) => e.stopPropagation()} className={cn(trigger, triggerClass)}>{shown}</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto" onKeyDown={(e) => e.stopPropagation()}>{children}</DropdownMenuContent>
      </DropdownMenu>
    </Isolated>
  );
}

function Options({ options }: { options: PickOption[] }) {
  return options.map((o) => (
    <DropdownMenuItem key={o.key} onSelect={(e) => { if (o.keepOpen) e.preventDefault(); o.onSelect(e); }}>
      {o.icon}{o.text}<Tick on={o.checked} />
    </DropdownMenuItem>
  ));
}

export function StatusPicker({ issue, editor, className }: { issue: IssueRow; editor: InlineEditor; className?: string }) {
  return (
    <Picker label={`Change status of ${issue.identifier}`} triggerClass="p-0.5" className={className} trigger={<StatusIcon status={issue.status} />}>
      <Options options={statusOptions(issue, editor)} />
    </Picker>
  );
}

export function PriorityPicker({ issue, editor, className }: { issue: IssueRow; editor: InlineEditor; className?: string }) {
  return (
    <Picker label={`Change priority of ${issue.identifier}`} triggerClass="p-0.5" className={className} trigger={<PriorityIcon priority={issue.priority as Priority} />}>
      <Options options={priorityOptions(issue, editor)} />
    </Picker>
  );
}

export function AssigneePicker({ issue, editor, size = 18, className }: { issue: IssueRow; editor: InlineEditor; size?: number; className?: string }) {
  return (
    <Picker label={`Change assignee of ${issue.identifier}`} triggerClass="rounded-full p-0.5" className={className} trigger={<ActorAvatar who={issue.assignee} size={size} />}>
      <Options options={assigneeOptions(issue, editor)} />
    </Picker>
  );
}

export function LabelsPicker({ issue, editor, visible = 2, className }: { issue: IssueRow; editor: InlineEditor; visible?: number; className?: string }) {
  const options = labelOptions(issue, editor);
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
      <Options options={options} />
    </Picker>
  );
}
