"use client";
import type { IssueStatus } from "@traccia/shared";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, CornerDownRight, ListTree, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { loadMoreIssues } from "@/app/(app)/issues/actions";
import { ActorAvatar, AgentMark, STATUS_LABEL, StatusIcon } from "@/components/traccia/atoms";
import { InlineEditNotice } from "@/components/inline-edit/notice";
import { AssigneePicker, LabelsPicker, PriorityPicker, StatusPicker } from "@/components/inline-edit/pickers";
import { upsertRow } from "@/components/inline-edit/rows";
import { useInlineEdit } from "@/components/inline-edit/use-inline-edit";
import { Button } from "@/components/ui/button";
import type { IssueRow, Label, Milestone, Project } from "@/lib/api/schemas";
import type { IssueFilters } from "@/lib/issue-filters";
import { buildSections, subIssueCounts } from "./group-rows";
import { timeAgo } from "./format";
import { PriorityIcon } from "./priority";
import { countsOf, sameGroups, type GroupsApplier } from "./use-list-sync";

export type IssueGroup = { status: IssueStatus; items: IssueRow[]; nextCursor: string | null };

/** Section keys (a status, or the key of another grouping). */
export const COLLAPSED_BY_DEFAULT: string[] = ["done", "canceled"];

type GroupState = IssueGroup & { error?: string };

export function IssuesTable({
  groups: initial, query, filters, milestones, projects = [], labels = [], collapsed, onToggle, onSort, register,
}: {
  groups: IssueGroup[]; query: string; filters: IssueFilters; milestones: Milestone[]; projects?: Project[]; labels?: Label[]; collapsed: Set<string>; onToggle: (key: string) => void; onSort: (by: IssueFilters["orderBy"]) => void; register?: (a: GroupsApplier | null) => void;
}) {
  const [groups, setGroups] = useState<GroupState[]>(initial);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState<Set<IssueStatus>>(new Set());
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  // Live refresh (MAT-1726): the poll swaps in fresh groups; expanded/collapsed state lives in IssuesView, scroll is untouched.
  const inline = useInlineEdit({ onRow: (row) => setGroups((gs) => upsertRow(gs, row)) });
  const editor = { edit: inline.edit, labels };
  useEffect(() => {
    register?.({
      counts: () => countsOf(groupsRef.current),
      apply: (fresh) => {
        if (inline.pending.current > 0) return false;
        if (!sameGroups(groupsRef.current, fresh)) setGroups(fresh);
        return true;
      },
    });
    return () => register?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register]);
  const milestoneName = new Map(milestones.map((m) => [m.id, m.name]));
  const sections = buildSections(groups, filters.groupBy, filters, { projects, milestones });
  const everyRow = groups.flatMap((g) => g.items);
  const parentOf = new Map(everyRow.map((r) => [r.id, r.identifier]));
  const children = subIssueCounts(everyRow);
  const pagedGroups = groups.filter((g) => g.nextCursor);

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
      {inline.notice && <InlineEditNotice notice={inline.notice} onDismiss={inline.dismiss} />}
      <div className="sticky top-0 z-10 flex h-7 items-center gap-3 border-b bg-background/95 px-4 text-[11px] font-medium text-muted-foreground backdrop-blur">
        {sortButton("priority", "Priority", "w-[96px]")}
        {sortButton("title", "Title", "flex-1")}
        <span className="w-32">Milestone</span>
        <span className="w-8 text-center">Est.</span>
        <span className="w-[18px]" />
        {sortButton("updatedAt", "Updated", "w-12 justify-end")}
      </div>
      {sections.map((g) => {
        const isCollapsed = collapsed.has(g.key);
        const group = g.status ? groups.find((x) => x.status === g.status) : undefined;
        return (
          <section key={g.key} aria-label={g.status ? STATUS_LABEL[g.status] : g.title}>
            <h2 className="m-0 flex h-8 items-center border-b bg-surface px-4 text-[13px] font-medium">
              <button type="button" aria-expanded={!isCollapsed} onClick={() => onToggle(g.key)} className="flex items-center gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {isCollapsed ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
                {g.status ? <StatusIcon status={g.status} /> : filters.groupBy === "priority" ? <PriorityIcon priority={Number(g.raw) as 0} /> : filters.groupBy === "assignee" ? <ActorAvatar who={g.raw === "none" ? null : (g.raw as "you" | "agent")} size={16} /> : null}
                <span>{g.status ? STATUS_LABEL[g.status] : g.title}</span>
                <span className="text-xs font-normal text-muted-foreground" data-testid={`count-${g.key}`}>{g.items.length}{(group ? group.nextCursor : pagedGroups.length > 0) ? "+" : ""}</span>
              </button>
            </h2>
            <div>
              {!isCollapsed && g.items.map((i) => {
                const parent = i.parentId ? parentOf.get(i.parentId) : undefined;
                const sub = children.get(i.id);
                return (
                <div key={i.id} className="relative flex h-9 items-center gap-3 border-b px-4 text-[13px] hover:bg-accent/50 focus-within:bg-accent/50">
                  <span className="flex w-[96px] shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
                    <PriorityPicker issue={i} editor={editor} />
                    {i.identifier}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <StatusPicker issue={i} editor={editor} />
                    {/* The link's overlay makes the whole row clickable; the pickers sit above it. */}
                    <Link href={`/issues/${i.identifier}`} className="truncate rounded outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring">{i.title}</Link>
                    {i.parentId && (
                      <span data-testid="parent-marker" className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
                        <CornerDownRight aria-label="Sub-issue of" role="img" className="size-3" />{parent ?? "parent"}
                      </span>
                    )}
                    {sub && (
                      <span data-testid="sub-progress" className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                        <ListTree aria-hidden className="size-3" />{sub.done}/{sub.total}<span className="sr-only"> sub-issues done</span>
                      </span>
                    )}
                    {i.createdBy === "agent" && i.status === "backlog" && <AgentMark />}
                    <LabelsPicker issue={i} editor={editor} className="ml-1 shrink-0" />
                  </span>
                  <span className="w-32 truncate text-xs text-muted-foreground">{i.milestoneId ? milestoneName.get(i.milestoneId) : ""}</span>
                  <span className="w-8 text-center font-mono text-xs text-muted-foreground">{i.estimate ?? ""}</span>
                  <AssigneePicker issue={i} editor={editor} />
                  <time suppressHydrationWarning dateTime={i.updatedAt} className="w-12 text-right text-xs text-muted-foreground">{timeAgo(i.updatedAt)}</time>
                </div>
                );
              })}
              {!isCollapsed && group?.nextCursor && <LoadMore group={group} loading={loading.has(group.status)} onMore={more} />}
            </div>
          </section>
        );
      })}
      {filters.groupBy !== "status" && pagedGroups.map((g) => <LoadMore key={g.status} group={g} loading={loading.has(g.status)} onMore={more} />)}
    </div>
  );
}

function LoadMore({ group, loading, onMore }: { group: GroupState; loading: boolean; onMore: (g: GroupState) => void }) {
  return (
    <div className="flex items-center gap-3 border-b px-4 py-1.5">
      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" disabled={loading} onClick={() => onMore(group)}>
        {loading && <Loader2 className="size-3.5 animate-spin" />}
        Load more {STATUS_LABEL[group.status].toLowerCase()}
      </Button>
      {group.error && <span role="alert" className="text-xs text-destructive">{group.error}</span>}
    </div>
  );
}
