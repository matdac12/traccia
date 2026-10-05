"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Columns3, ListFilter, Plus, Rows3, Search, X } from "lucide-react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LABELS, MILESTONES, PRIORITIES, PROJECTS, STATUSES, type Issue, type Status, timeAgo } from "@/lib/mock-data";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AgentMark, Assignee, LabelChip, PriorityIcon, StatusIcon } from "./atoms";
import { CreateIssueDialog } from "./create-issue-dialog";

type Filters = { project: string[]; assignee: string[]; label: string[]; priority: string[]; milestone: string[] };
const EMPTY: Filters = { project: [], assignee: [], label: [], priority: [], milestone: [] };

function useFilters(fixedProject?: string) {
  const [f, setF] = useState<Filters>(fixedProject ? { ...EMPTY, project: [fixedProject] } : EMPTY);
  const [q, setQ] = useState("");
  const toggle = (k: keyof Filters, v: string) => setF((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));
  const clear = () => { setF(fixedProject ? { ...EMPTY, project: [fixedProject] } : EMPTY); setQ(""); };
  return { f, q, setQ, toggle, clear };
}

function applyFilters(issues: Issue[], f: Filters, q: string) {
  return issues.filter((i) => {
    if (f.project.length && !f.project.includes(i.projectKey)) return false;
    if (f.assignee.length && !f.assignee.includes(i.assignee ?? "none")) return false;
    if (f.label.length && !f.label.some((l) => i.labels.includes(l))) return false;
    if (f.priority.length && !f.priority.includes(String(i.priority))) return false;
    if (f.milestone.length && !f.milestone.includes(i.milestoneId ?? "")) return false;
    if (q && !`${i.identifier} ${i.title} ${i.description}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
}

function FilterMenu({ f, toggle, hideProject }: { f: Filters; toggle: (k: keyof Filters, v: string) => void; hideProject?: boolean }) {
  const sec = (k: keyof Filters, title: string, opts: { v: string; l: React.ReactNode }[]) => (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="text-[13px]">{title}{f[k].length > 0 && <span className="ml-auto text-xs text-primary">{f[k].length}</span>}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-44">
        {opts.map((o) => <DropdownMenuCheckboxItem key={o.v} checked={f[k].includes(o.v)} onCheckedChange={() => toggle(k, o.v)} onSelect={(e) => e.preventDefault()}>{o.l}</DropdownMenuCheckboxItem>)}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[13px] text-muted-foreground"><ListFilter className="size-3.5" />Filter</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Filter by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!hideProject && sec("project", "Project", PROJECTS.map((p) => ({ v: p.key, l: p.name })))}
        {sec("assignee", "Assignee", [{ v: "you", l: <><Assignee who="you" />You</> }, { v: "agent", l: <><Assignee who="agent" />Agent</> }, { v: "none", l: <><Assignee who={null} />Unassigned</> }])}
        {sec("label", "Labels", LABELS.map((l) => ({ v: l.name, l: <LabelChip name={l.name} /> })))}
        {sec("priority", "Priority", PRIORITIES.map((p) => ({ v: String(p.key), l: <><PriorityIcon priority={p.key} />{p.label}</> })))}
        {sec("milestone", "Milestone", MILESTONES.map((m) => ({ v: m.id, l: m.name })))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActiveChips({ f, toggle, fixedProject }: { f: Filters; toggle: (k: keyof Filters, v: string) => void; fixedProject?: string }) {
  const chips = (Object.keys(f) as (keyof Filters)[]).flatMap((k) => f[k].filter((v) => !(k === "project" && v === fixedProject)).map((v) => ({ k, v })));
  if (!chips.length) return null;
  const label = (k: keyof Filters, v: string) => k === "project" ? PROJECTS.find((p) => p.key === v)?.name : k === "priority" ? PRIORITIES.find((p) => String(p.key) === v)?.label : k === "milestone" ? MILESTONES.find((m) => m.id === v)?.name : v === "none" ? "Unassigned" : v;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-1.5">
      {chips.map(({ k, v }) => (
        <span key={k + v} className="inline-flex h-6 items-center gap-1 rounded-md border bg-muted/50 pl-2 pr-1 text-xs">
          <span className="text-muted-foreground">{k}:</span>{label(k, v)}
          <button onClick={() => toggle(k, v)} className="grid size-4 place-items-center rounded hover:bg-accent"><X className="size-3" /></button>
        </span>
      ))}
    </div>
  );
}

export function IssuesView({ fixedProject, title = "Issues" }: { fixedProject?: string; title?: string }) {
  const { issues } = useStore();
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const view = sp.get("view") === "kanban" ? "kanban" : "table";
  const { f, q, setQ, toggle, clear } = useFilters(fixedProject);
  const [create, setCreate] = useState<Status | null>(null);
  const filtered = useMemo(() => applyFilters(issues, f, q), [issues, f, q]);
  const setView = (v: string) => v && router.replace(`${path}?view=${v}`, { scroll: false });

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <h1 className="text-[13px] font-medium">{title}</h1>
        <span className="text-xs text-muted-foreground">{filtered.length}</span>
        <div className="mx-2 h-4 w-px bg-border" />
        <FilterMenu f={f} toggle={toggle} hideProject={!!fixedProject} />
        <div className="relative">
          <Search className="absolute left-2 top-1.5 size-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-7 w-48 pl-7 text-[13px]" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ToggleGroup type="single" value={view} onValueChange={setView} variant="outline" size="sm">
            <ToggleGroupItem value="table" aria-label="Table view" className="h-7 gap-1.5 px-2 text-xs"><Rows3 className="size-3.5" />Table</ToggleGroupItem>
            <ToggleGroupItem value="kanban" aria-label="Kanban view" className="h-7 gap-1.5 px-2 text-xs"><Columns3 className="size-3.5" />Board</ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" className="h-7 gap-1 text-[13px]" onClick={() => setCreate("backlog")}><Plus className="size-3.5" />New</Button>
        </div>
      </header>
      <ActiveChips f={f} toggle={toggle} fixedProject={fixedProject} />
      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.length === 0 ? <Empty onClear={clear} /> : view === "table" ? <TableView issues={filtered} onAdd={setCreate} /> : <KanbanView issues={filtered} onAdd={setCreate} />}
      </div>
      <CreateIssueDialog open={create !== null} onOpenChange={(o) => !o && setCreate(null)} defaultStatus={create ?? undefined} defaultProject={fixedProject} />
    </div>
  );
}

function Empty({ onClear }: { onClear: () => void }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="text-center">
        <p className="text-sm font-medium">No issues match</p>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">Try removing a filter or changing your search.</p>
        <Button size="sm" variant="outline" onClick={onClear}>Clear filters</Button>
      </div>
    </div>
  );
}

function TableView({ issues, onAdd }: { issues: Issue[]; onAdd: (s: Status) => void }) {
  const { flashed } = useStore();
  const [collapsed, setCollapsed] = useState<Set<Status>>(new Set(["done", "canceled"]));
  const ms = (id: string | null) => MILESTONES.find((m) => m.id === id)?.name;
  return (
    <div className="min-w-[860px]">
      <div className="sticky top-0 z-10 flex h-7 items-center gap-3 border-b bg-background/95 px-4 text-[11px] font-medium text-muted-foreground backdrop-blur">
        <span className="w-[96px]">ID</span><span className="flex-1">Title</span><span className="w-32">Milestone</span><span className="w-8 text-center">Est.</span><span className="w-5" /><span className="w-12 text-right">Updated</span>
      </div>
      {STATUSES.map((s) => {
        const rows = issues.filter((i) => i.status === s.key);
        if (!rows.length) return null;
        const isCollapsed = collapsed.has(s.key);
        return (
          <section key={s.key}>
            <div className="group flex h-8 items-center gap-2 border-b bg-surface px-4">
              <button className="flex items-center gap-2" onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(s.key) ? n.delete(s.key) : n.add(s.key); return n; })}>
                {isCollapsed ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
                <StatusIcon status={s.key} /><span className="text-[13px] font-medium">{s.label}</span><span className="text-xs text-muted-foreground">{rows.length}</span>
              </button>
              <Button variant="ghost" size="icon" className="ml-auto size-5 opacity-0 group-hover:opacity-100" onClick={() => onAdd(s.key)}><Plus className="size-3.5" /></Button>
            </div>
            {!isCollapsed && rows.map((i) => (
              <Link key={i.identifier} href={`/issues/${i.identifier}`} className={cn("flex h-9 items-center gap-3 border-b px-4 text-[13px] hover:bg-accent/50", flashed.has(i.identifier) && "agent-flash")}>
                <span className="flex w-[96px] items-center gap-2 font-mono text-xs text-muted-foreground"><PriorityIcon priority={i.priority} />{i.identifier}</span>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <StatusIcon status={i.status} />
                  <span className="truncate">{i.title}</span>
                  {i.createdBy === "agent" && i.status === "backlog" && <AgentMark />}
                  <span className="ml-1 flex shrink-0 gap-1">{i.labels.slice(0, 2).map((l) => <LabelChip key={l} name={l} />)}</span>
                </span>
                <span className="w-32 truncate text-xs text-muted-foreground">{ms(i.milestoneId)}</span>
                <span className="w-8 text-center font-mono text-xs text-muted-foreground">{i.estimate ?? ""}</span>
                <Assignee who={i.assignee} />
                <span className="w-12 text-right text-xs text-muted-foreground">{timeAgo(i.updatedAt)}</span>
              </Link>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Card({ issue, overlay }: { issue: Issue; overlay?: boolean }) {
  const { flashed } = useStore();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: issue.identifier });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn("cursor-grab rounded-lg border bg-card p-2.5 shadow-sm transition-colors hover:border-foreground/20", isDragging && !overlay && "opacity-30", overlay && "rotate-1 shadow-xl", flashed.has(issue.identifier) && "agent-flash")}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted-foreground">{issue.identifier}</span>
        <Assignee who={issue.assignee} size={16} />
      </div>
      <Link href={`/issues/${issue.identifier}`} onPointerDown={(e) => e.stopPropagation()} className="line-clamp-2 text-[13px] leading-snug hover:underline">{issue.title}</Link>
      <div className="mt-2 flex items-center gap-1.5">
        <PriorityIcon priority={issue.priority} />
        {issue.labels.slice(0, 2).map((l) => <LabelChip key={l} name={l} />)}
        {issue.estimate != null && <span className="ml-auto font-mono text-[11px] text-muted-foreground">{issue.estimate}pt</span>}
      </div>
    </div>
  );
}

function Column({ status, issues, onAdd }: { status: Status; issues: Issue[]; onAdd: (s: Status) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const label = STATUSES.find((s) => s.key === status)!.label;
  return (
    <div className="flex w-[280px] shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <StatusIcon status={status} /><span className="text-[13px] font-medium">{label}</span><span className="text-xs text-muted-foreground">{issues.length}</span>
        <Button variant="ghost" size="icon" className="ml-auto size-5" onClick={() => onAdd(status)}><Plus className="size-3.5" /></Button>
      </div>
      <div ref={setNodeRef} className={cn("flex min-h-24 flex-1 flex-col gap-2 rounded-lg border border-transparent bg-surface p-1.5 transition-colors", isOver && "border-primary/40 bg-primary/5")}>
        {issues.map((i) => <Card key={i.identifier} issue={i} />)}
      </div>
    </div>
  );
}

function KanbanView({ issues, onAdd }: { issues: Issue[]; onAdd: (s: Status) => void }) {
  const { update } = useStore();
  const [active, setActive] = useState<Issue | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onEnd = (e: DragEndEvent) => {
    setActive(null);
    const to = e.over?.id as Status | undefined;
    const issue = issues.find((i) => i.identifier === e.active.id);
    if (to && issue && issue.status !== to) update(issue.identifier, { status: to }, `changed status from ${STATUSES.find((s) => s.key === issue.status)!.label} to ${STATUSES.find((s) => s.key === to)!.label}`);
  };
  return (
    <DndContext sensors={sensors} onDragStart={(e) => setActive(issues.find((i) => i.identifier === e.active.id) ?? null)} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
      <div className="flex h-full gap-3 p-4">
        {STATUSES.map((s) => <Column key={s.key} status={s.key} issues={issues.filter((i) => i.status === s.key)} onAdd={onAdd} />)}
      </div>
      <DragOverlay>{active && <Card issue={active} overlay />}</DragOverlay>
    </DndContext>
  );
}
