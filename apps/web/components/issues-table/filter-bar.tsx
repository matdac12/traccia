"use client";
import { ListFilter, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ISSUE_STATUSES, type IssueStatus } from "@traccia/shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Label, Milestone, Project } from "@/lib/api/schemas";
import type { IssueFilters } from "@/lib/issue-filters";
import { PRIORITY_LABEL, PriorityIcon } from "./priority";
import { ActorAvatar, STATUS_LABEL, StatusIcon } from "@/components/traccia/atoms";
import { LabelChip } from "./label-chip";
import { useDebouncedCallback } from "./use-debounced-callback";

export const SEARCH_DEBOUNCE_MS = 300;

type Lookups = { projects: Project[]; labels: Label[]; milestones: Milestone[] };
type Section = { key: string; title: string; selected: string[]; options: { value: string; label: React.ReactNode }[]; toggle: (v: string) => void };

export function FilterMenu({ filters, lookups, onChange, hideProject = false }: { filters: IssueFilters; lookups: Lookups; onChange: (next: IssueFilters) => void; hideProject?: boolean }) {
  const single = <K extends "project" | "assignee" | "milestone">(key: K) => (v: string) => onChange({ ...filters, [key]: filters[key] === v ? undefined : v } as IssueFilters);
  const milestones = filters.project ? lookups.milestones.filter((m) => m.projectId === filters.project) : lookups.milestones;
  const labels = filters.project ? lookups.labels.filter((l) => !l.projectId || l.projectId === filters.project) : lookups.labels;
  const sections: Section[] = [
    { key: "project", title: "Project", selected: filters.project ? [filters.project] : [], toggle: single("project"), options: lookups.projects.map((p) => ({ value: p.id, label: p.name })) },
    {
      key: "status", title: "Status", selected: filters.status,
      toggle: (s) => onChange({ ...filters, status: filters.status.includes(s as IssueStatus) ? filters.status.filter((x) => x !== s) : ISSUE_STATUSES.filter((x) => x === s || filters.status.includes(x)) }),
      options: ISSUE_STATUSES.map((s) => ({ value: s, label: <><StatusIcon status={s} /> {STATUS_LABEL[s]}</> })),
    },
    {
      key: "assignee", title: "Assignee", selected: filters.assignee ? [filters.assignee] : [], toggle: single("assignee"),
      options: [
        { value: "you", label: <><ActorAvatar who="you" size={16} /> You</> },
        { value: "agent", label: <><ActorAvatar who="agent" size={16} /> Agent</> },
        { value: "none", label: <><ActorAvatar who={null} size={16} /> Unassigned</> },
      ],
    },
    {
      key: "label", title: "Labels", selected: filters.labels,
      toggle: (name) => onChange({ ...filters, labels: filters.labels.includes(name) ? filters.labels.filter((l) => l !== name) : [...filters.labels, name] }),
      options: [...new Map(labels.map((l) => [l.name, l])).values()].map((l) => ({ value: l.name, label: <LabelChip name={l.name} color={l.color} /> })),
    },
    {
      key: "priority", title: "Priority", selected: filters.priority !== undefined ? [String(filters.priority)] : [],
      toggle: (v) => onChange({ ...filters, priority: filters.priority === Number(v) ? undefined : (Number(v) as IssueFilters["priority"]) }),
      options: ([1, 2, 3, 4, 0] as const).map((p) => ({ value: String(p), label: <><PriorityIcon priority={p} /> {PRIORITY_LABEL[p]}</> })),
    },
    { key: "milestone", title: "Milestone", selected: filters.milestone ? [filters.milestone] : [], toggle: single("milestone"), options: milestones.map((m) => ({ value: m.id, label: m.name })) },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[13px] text-muted-foreground"><ListFilter className="size-3.5" />Filter</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Filter by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sections.filter((s) => !(hideProject && s.key === "project")).map((s) => (
          <DropdownMenuSub key={s.key}>
            <DropdownMenuSubTrigger className="text-[13px]">
              {s.title}
              {s.selected.length > 0 && <span className="ml-auto text-xs text-primary">{s.selected.length}</span>}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 min-w-44 overflow-y-auto">
              {s.options.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">None yet</div>}
              {s.options.map((o) => (
                <DropdownMenuCheckboxItem key={o.value} checked={s.selected.includes(o.value)} onCheckedChange={() => s.toggle(o.value)} onSelect={(e) => e.preventDefault()}>
                  {o.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Debounced search box. The text follows the URL only when `value` changes from outside (back/forward, clear), so typing never loses focus. */
export function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(value);
  const emitted = useRef(value);
  const debounced = useDebouncedCallback((q: string) => { emitted.current = q; onSearch(q); }, SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    if (value !== emitted.current) { emitted.current = value; setText(value); }
  }, [value]);
  return (
    <div className="relative order-last w-full sm:order-none sm:w-auto">
      <Search className="absolute left-2 top-1.5 size-3.5 text-muted-foreground" />
      <Input
        type="search"
        aria-label="Search issues"
        value={text}
        onChange={(e) => { setText(e.target.value); debounced(e.target.value); }}
        placeholder="Search…"
        className="h-8 w-full pl-7 text-[13px] sm:h-7 sm:w-48"
      />
    </div>
  );
}

export function ActiveChips({ filters, lookups, onChange, hideProject = false }: { filters: IssueFilters; lookups: Lookups; onChange: (next: IssueFilters) => void; hideProject?: boolean }) {
  const chips: { key: string; kind: string; text: string; remove: IssueFilters }[] = [];
  if (filters.project && !hideProject) chips.push({ key: "project", kind: "project", text: lookups.projects.find((p) => p.id === filters.project)?.name ?? filters.project, remove: { ...filters, project: undefined } });
  for (const s of filters.status) chips.push({ key: `status:${s}`, kind: "status", text: STATUS_LABEL[s], remove: { ...filters, status: filters.status.filter((x) => x !== s) } });
  if (filters.assignee) chips.push({ key: "assignee", kind: "assignee", text: filters.assignee === "none" ? "Unassigned" : filters.assignee === "you" ? "You" : "Agent", remove: { ...filters, assignee: undefined } });
  for (const l of filters.labels) chips.push({ key: `label:${l}`, kind: "label", text: l, remove: { ...filters, labels: filters.labels.filter((x) => x !== l) } });
  if (filters.priority !== undefined) chips.push({ key: "priority", kind: "priority", text: PRIORITY_LABEL[filters.priority], remove: { ...filters, priority: undefined } });
  if (filters.milestone) chips.push({ key: "milestone", kind: "milestone", text: lookups.milestones.find((m) => m.id === filters.milestone)?.name ?? filters.milestone, remove: { ...filters, milestone: undefined } });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5 sm:px-4">
      {chips.map((c) => (
        <span key={c.key} className="inline-flex h-6 items-center gap-1 rounded-md border bg-muted/50 pl-2 pr-1 text-xs">
          <span className="text-muted-foreground">{c.kind}:</span>
          {c.text}
          <button type="button" aria-label={`Remove ${c.kind} filter ${c.text}`} onClick={() => onChange(c.remove)} className="grid size-4 place-items-center rounded hover:bg-accent"><X className="size-3" /></button>
        </span>
      ))}
    </div>
  );
}
