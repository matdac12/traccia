"use client";

import { Check, X } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { ActorAvatar, StatusIcon, STATUS_LABEL } from "@/components/traccia/atoms";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { IssueDetail, IssueRef, Label, Milestone } from "@/lib/api/schemas";
import { ISSUE_STATUSES } from "@traccia/shared";
import { cn } from "@/lib/utils";
import { LabelChip, PRIORITY_OPTIONS, PriorityIcon, TimeAgo } from "./atoms";
import { IssuePicker } from "./issue-picker";

export type Change = (label: string, build: (current: IssueDetail) => Record<string, unknown>, optimistic?: Partial<IssueDetail>) => void;

const ESTIMATES = [1, 2, 3, 5, 8, 13];
const trigger = "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-accent disabled:opacity-60";

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Menu({ label, disabled, trigger: t, children }: { label: string; disabled?: boolean; trigger: ReactNode; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={label} disabled={disabled} className={trigger}>{t}</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

const Tick = ({ on }: { on: boolean }) => (on ? <Check className="ml-auto size-3.5 text-primary" /> : null);

export function Properties({ issue, projects, labels, milestones, parent, onChange, disabled }: {
  issue: IssueDetail;
  projects: { id: string; key: string; name: string }[];
  labels: Label[];
  milestones: Milestone[];
  parent: IssueRef | null;
  onChange: Change;
  disabled?: boolean;
}) {
  const [pickingParent, setPickingParent] = useState(false);
  const project = projects.find((p) => p.id === issue.projectId);
  const milestone = milestones.find((m) => m.id === issue.milestoneId);
  const estimates = issue.estimate !== null && !ESTIMATES.includes(issue.estimate) ? [...ESTIMATES, issue.estimate].sort((a, b) => a - b) : ESTIMATES;

  return (
    <div className="space-y-0.5">
      <Prop label="Status">
        <Menu label="Status" disabled={disabled} trigger={<><StatusIcon status={issue.status} />{STATUS_LABEL[issue.status]}</>}>
          {ISSUE_STATUSES.map((s) => (
            <DropdownMenuItem key={s} onSelect={() => s !== issue.status && onChange(`status to ${STATUS_LABEL[s]}`, () => ({ status: s }), { status: s })}>
              <StatusIcon status={s} />{STATUS_LABEL[s]}<Tick on={s === issue.status} />
            </DropdownMenuItem>
          ))}
        </Menu>
      </Prop>
      <Prop label="Priority">
        <Menu label="Priority" disabled={disabled} trigger={<><PriorityIcon priority={issue.priority} />{PRIORITY_OPTIONS[issue.priority]?.label}</>}>
          {PRIORITY_OPTIONS.map((p) => (
            <DropdownMenuItem key={p.value} onSelect={() => p.value !== issue.priority && onChange(`priority to ${p.label}`, () => ({ priority: p.value }), { priority: p.value })}>
              <PriorityIcon priority={p.value} />{p.label}<Tick on={p.value === issue.priority} />
            </DropdownMenuItem>
          ))}
        </Menu>
      </Prop>
      <Prop label="Assignee">
        <Menu label="Assignee" disabled={disabled} trigger={<><ActorAvatar who={issue.assignee} size={16} />{issue.assignee === "you" ? "You" : issue.assignee === "agent" ? "Agent" : <span className="text-muted-foreground">Unassigned</span>}</>}>
          {([[null, "Unassigned"], ["you", "You"], ["agent", "Agent"]] as const).map(([v, text]) => (
            <DropdownMenuItem key={text} onSelect={() => v !== issue.assignee && onChange(`assignee to ${text}`, () => ({ assignee: v }), { assignee: v })}>
              <ActorAvatar who={v} size={16} />{text}<Tick on={v === issue.assignee} />
            </DropdownMenuItem>
          ))}
        </Menu>
      </Prop>
      <Prop label="Estimate">
        <Menu label="Estimate" disabled={disabled} trigger={issue.estimate === null ? <span className="text-muted-foreground">No estimate</span> : `${issue.estimate} points`}>
          <DropdownMenuItem onSelect={() => issue.estimate !== null && onChange("estimate", () => ({ estimate: null }), { estimate: null })}>No estimate<Tick on={issue.estimate === null} /></DropdownMenuItem>
          {estimates.map((n) => (
            <DropdownMenuItem key={n} onSelect={() => n !== issue.estimate && onChange(`estimate to ${n}`, () => ({ estimate: n }), { estimate: n })}>{n} points<Tick on={n === issue.estimate} /></DropdownMenuItem>
          ))}
        </Menu>
      </Prop>
      <Prop label="Labels">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Labels" disabled={disabled} className="flex min-h-7 w-full flex-wrap items-center gap-1 rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent disabled:opacity-60">
              {issue.labels.length ? issue.labels.map((l) => <LabelChip key={l.id} name={l.name} color={l.color} />) : <span className="text-muted-foreground">Add labels</span>}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
            {labels.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No labels yet.</div>}
            {labels.map((l) => {
              const names = issue.labels.map((x) => x.name);
              const on = names.includes(l.name);
              // Toggle against the latest labels, so a re-apply after a conflict keeps others' changes.
              const toggle = (cur: string[]) => (cur.includes(l.name) ? cur.filter((x) => x !== l.name) : [...cur, l.name]);
              return (
                <DropdownMenuItem key={l.id} onSelect={(e) => { e.preventDefault(); onChange(`label ${l.name}`, (cur) => ({ labels: toggle(cur.labels.map((x) => x.name)) }), { labels: toggle(names).map((n) => labels.find((x) => x.name === n)).filter((x) => x !== undefined) }); }}>
                  <span className="size-2 rounded-full" style={{ background: l.color }} />{l.name}<Tick on={on} />
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </Prop>

      <div className="my-3 border-t" />

      <Prop label="Project">
        <Menu label="Project" disabled={disabled} trigger={project?.name ?? issue.key}>
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => p.id !== issue.projectId && onChange(`project to ${p.name}`, () => ({ project: p.key }))}>{p.name}<Tick on={p.id === issue.projectId} /></DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <div className="max-w-56 px-2 py-1 text-[11px] text-muted-foreground">Moving clears the parent and milestone, and takes sub-issues along.</div>
        </Menu>
      </Prop>
      <Prop label="Milestone">
        <Menu label="Milestone" disabled={disabled} trigger={milestone ? milestone.name : <span className="text-muted-foreground">No milestone</span>}>
          <DropdownMenuItem onSelect={() => issue.milestoneId && onChange("milestone", () => ({ milestoneId: null }), { milestoneId: null })}>No milestone<Tick on={!issue.milestoneId} /></DropdownMenuItem>
          {milestones.map((m) => (
            <DropdownMenuItem key={m.id} onSelect={() => m.id !== issue.milestoneId && onChange(`milestone to ${m.name}`, () => ({ milestoneId: m.id }), { milestoneId: m.id })}>{m.name}<Tick on={m.id === issue.milestoneId} /></DropdownMenuItem>
          ))}
        </Menu>
      </Prop>
      <Prop label="Parent">
        {parent ? (
          <div className="flex h-7 items-center gap-1 px-2 text-[13px]">
            <Link href={`/issues/${parent.identifier}`} className="min-w-0 truncate hover:underline"><span className="font-mono text-xs text-muted-foreground">{parent.identifier}</span> {parent.title}</Link>
            <button type="button" disabled={disabled} aria-label="Remove parent" onClick={() => onChange("parent", () => ({ parentId: null }), { parentId: null })} className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-accent"><X className="size-3.5" /></button>
          </div>
        ) : (
          <button type="button" disabled={disabled} className={cn(trigger, "text-muted-foreground")} onClick={() => setPickingParent((v) => !v)}>No parent</button>
        )}
      </Prop>
      {pickingParent && !parent && (
        <IssuePicker autoFocus exclude={[issue.identifier]} placeholder="Parent identifier or title…" onPick={(p) => { setPickingParent(false); onChange(`parent to ${p.identifier}`, () => ({ parentId: p.id })); }} />
      )}
      <Prop label="Created"><span className="px-2 text-[13px] text-muted-foreground"><TimeAgo iso={issue.createdAt} suffix=" ago" /></span></Prop>
      <Prop label="Updated"><span className="px-2 text-[13px] text-muted-foreground"><TimeAgo iso={issue.updatedAt} suffix=" ago" /></span></Prop>
    </div>
  );
}
