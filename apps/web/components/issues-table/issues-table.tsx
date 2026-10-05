"use client";
import type { IssueStatus, Priority } from "@traccia/shared";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { loadMoreIssues } from "@/app/(app)/issues/actions";
import { ActorAvatar, AgentMark, STATUS_LABEL, StatusIcon } from "@/components/traccia/atoms";
import { Button } from "@/components/ui/button";
import type { IssueRow, Label, Milestone } from "@/lib/api/schemas";
import type { IssueFilters } from "@/lib/issue-filters";
import { timeAgo } from "./format";
import { LabelChip } from "./label-chip";
import { PriorityIcon } from "./priority";
import { countsOf, sameGroups, type GroupsApplier } from "./use-list-sync";

export type IssueGroup = { status: IssueStatus; items: IssueRow[]; nextCursor: string | null };

export const COLLAPSED_BY_DEFAULT: IssueStatus[] = ["done", "canceled"];
const VISIBLE_LABELS = 2;

type GroupState = IssueGroup & { error?: string };

export function IssuesTable({
  groups: initial, query, filters, milestones, collapsed, onToggle, onSort, register,
}: {
  groups: IssueGroup[]; query: string; filters: IssueFilters; milestones: Milestone[]; collapsed: Set<IssueStatus>; onToggle: (s: IssueStatus) => void; onSort: (by: IssueFilters["orderBy"]) => void; register?: (a: GroupsApplier | null) => void;
}) {
  const [groups, setGroups] = useState<GroupState[]>(initial);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState<Set<IssueStatus>>(new Set());
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  // Live refresh (MAT-1726): the poll swaps in fresh groups; expanded/collapsed state lives in IssuesView, scroll is untouched.
  useEffect(() => {
    register?.({
      counts: () => countsOf(groupsRef.current),
      apply: (fresh) => {
        if (!sameGroups(groupsRef.current, fresh)) setGroups(fresh);
        return true;
      },
    });
    return () => register?.(null);
  }, [register]);
  const milestoneName = new Map(milestones.map((m) => [m.id, m.name]));

  const more = (group: GroupState) => {
    if (!group.nextCursor) return;
    const cursor = group.nextCursor;
    setLoading((l) => new Set(l).add(group.status));
    startTransition(async () => {
      try {
        const page = await loadMoreIssues({ query, status: group.status, cursor });
        setGroups((gs) => gs.map((g) => (g.status === group.status ? { status: g.status, items: [...g.items, ...page.items], nextCursor: page.nextCursor } : g)));
      } catch {
        setGroups((gs) => gs.map((g) => (g.status === group.status ? { ...g, error: "Could not load more issues." } : g)));
      } finally {
        setLoading((l) => { const n = new Set(l); n.delete(group.status); return n; });
      }
    });
  };

  const sortButton = (by: IssueFilters["orderBy"], text: string, className: string) => (
    <button type="button" onClick={() => onSort(by)} className={`inline-flex items-center gap-1 hover:text-foreground ${className}`} aria-label={`Sort by ${text}`}>
      {text}
      {filters.orderBy === by && (filters.order === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
    </button>
  );

  return (
    <div className="min-w-[860px]" aria-busy={pending}>
      <div className="sticky top-0 z-10 flex h-7 items-center gap-3 border-b bg-background/95 px-4 text-[11px] font-medium text-muted-foreground backdrop-blur">
        {sortButton("priority", "Priority", "w-[96px]")}
        <span className="flex-1">Title</span>
        <span className="w-32">Milestone</span>
        <span className="w-8 text-center">Est.</span>
        <span className="w-[18px]" />
        {sortButton("updatedAt", "Updated", "w-12 justify-end")}
      </div>
      {groups.map((g) => {
        if (!g.items.length) return null;
        const isCollapsed = collapsed.has(g.status);
                return (
          <section key={g.status} aria-label={STATUS_LABEL[g.status]}>
            <h2 className="m-0 flex h-8 items-center border-b bg-surface px-4 text-[13px] font-medium">
              <button type="button" aria-expanded={!isCollapsed} onClick={() => onToggle(g.status)} className="flex items-center gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {isCollapsed ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
                <StatusIcon status={g.status} />
                <span>{STATUS_LABEL[g.status]}</span>
                <span className="text-xs font-normal text-muted-foreground" data-testid={`count-${g.status}`}>{g.items.length}{g.nextCursor ? "+" : ""}</span>
              </button>
            </h2>
            <div>
              {!isCollapsed && g.items.map((i) => (
                <Link key={i.id} href={`/issues/${i.identifier}`} className="flex h-9 items-center gap-3 border-b px-4 text-[13px] outline-none hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <span className="flex w-[96px] shrink-0 items-center gap-2 font-mono text-xs text-muted-foreground">
                    <PriorityIcon priority={i.priority as Priority} />
                    {i.identifier}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <StatusIcon status={i.status} />
                    <span className="truncate">{i.title}</span>
                    {i.createdBy === "agent" && i.status === "backlog" && <AgentMark />}
                    <span className="ml-1 flex shrink-0 gap-1">
                      {i.labels.slice(0, VISIBLE_LABELS).map((l: Label) => <LabelChip key={l.id} name={l.name} color={l.color} />)}
                      {i.labels.length > VISIBLE_LABELS && <span className="text-[11px] text-muted-foreground">+{i.labels.length - VISIBLE_LABELS}</span>}
                    </span>
                  </span>
                  <span className="w-32 truncate text-xs text-muted-foreground">{i.milestoneId ? milestoneName.get(i.milestoneId) : ""}</span>
                  <span className="w-8 text-center font-mono text-xs text-muted-foreground">{i.estimate ?? ""}</span>
                  <ActorAvatar who={i.assignee} />
                  <time suppressHydrationWarning dateTime={i.updatedAt} className="w-12 text-right text-xs text-muted-foreground">{timeAgo(i.updatedAt)}</time>
                </Link>
              ))}
              {!isCollapsed && g.nextCursor && (
                <div className="flex items-center gap-3 border-b px-4 py-1.5">
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" disabled={loading.has(g.status)} onClick={() => more(g)}>
                    {loading.has(g.status) && <Loader2 className="size-3.5 animate-spin" />}
                    Load more {STATUS_LABEL[g.status].toLowerCase()}
                  </Button>
                  {g.error && <span role="alert" className="text-xs text-destructive">{g.error}</span>}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
