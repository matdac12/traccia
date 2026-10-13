"use client";
import type { IssueStatus } from "@traccia/shared";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, CornerDownRight, ListTree, Loader2 } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState, useTransition } from "react";
import { loadMoreIssues } from "@/app/(app)/issues/actions";
import { ActorAvatar, STATUS_LABEL, StatusIcon } from "@/components/traccia/atoms";
import { InlineEditNotice } from "@/components/inline-edit/notice";
import { AssigneePicker, LabelsPicker, PriorityPicker, StatusPicker } from "@/components/inline-edit/pickers";
import { insertRow, removeRow, upsertRow } from "@/components/inline-edit/rows";
import { useInlineEdit } from "@/components/inline-edit/use-inline-edit";
import { IssueContextMenu, IssueMenuButton, type IssueMenuContext } from "@/components/issue-menu/issue-context-menu";
import { useIssueDelete } from "@/components/issue-menu/use-issue-delete";
import { Button } from "@/components/ui/button";
import type { IssueRow, Label, Milestone, Project } from "@/lib/api/schemas";
import type { IssueFilters } from "@/lib/issue-filters";
import { buildSections, nestRows, subIssueCounts, type TreeRow } from "./group-rows";
import { timeAgo } from "./format";
import { PriorityIcon } from "./priority";
import { countsOf, sameGroups, type GroupsApplier } from "./use-list-sync";
import { BlockerBadge } from "./blocker-badge";
import { DEFAULT_ISSUE_COLUMNS, type IssueColumns } from "./columns";

export { DEFAULT_ISSUE_COLUMNS, type IssueColumns } from "./columns";

export type IssueGroup = { status: IssueStatus; items: IssueRow[]; nextCursor: string | null };

/** Section keys (a status, or the key of another grouping). */
export const COLLAPSED_BY_DEFAULT: string[] = ["done", "canceled"];

type GroupState = IssueGroup & { error?: string };

/** Indent of a sub-issue, in px: one connector column. */
const INDENT = 20;

/**
 * `--gutter` is where the title cell starts (phone: the row padding; md: after the 96 px identifier column) and `--mid`
 * the height of the status icon's centre, so the connectors meet the icon on both layouts.
 */
const ROW = [
  "group relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1 border-b border-border/60 px-4 py-2.5 text-[13px] [--gutter:1rem] [--mid:20px]",
  "transition-colors duration-150 hover:bg-accent/45 focus-within:bg-accent/50 data-[state=open]:bg-accent/50",
  "has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring/50",
  "md:flex md:h-[38px] md:items-center md:gap-3 md:py-0 md:[--gutter:7.75rem] md:[--mid:19px]",
].join(" ");

const GUIDE = "absolute w-px bg-foreground/20";

/** Tree lines of a sub-issue row: the elbow into its status icon, the lines of ancestors that continue below, and a stub down from its own icon when it has sub-issues below. */
function Connectors({ tree }: { tree: TreeRow }) {
  if (tree.depth === 0 && !tree.hasChildren) return null;
  // 9 px = the status icon's centre (2 px picker padding + half of the 14 px icon).
  const x = (level: number) => `calc(var(--gutter) + ${level * INDENT + 9}px)`;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {tree.guides.flatMap((on, level) => (on ? [level] : [])).map((level) => <span key={level} className={`${GUIDE} top-0 -bottom-px`} style={{ left: x(level) }} />)}
      {tree.depth > 0 && <span className="absolute top-0 w-3 rounded-bl-[7px] border-b border-l border-foreground/20" style={{ left: x(tree.depth - 1), height: "calc(var(--mid) + 0.5px)" }} />}
      {tree.depth > 0 && !tree.last && <span className={`${GUIDE} top-[var(--mid)] -bottom-px`} style={{ left: x(tree.depth - 1) }} />}
      {tree.hasChildren && <span className={`${GUIDE} top-[calc(var(--mid)+10px)] -bottom-px`} style={{ left: x(tree.depth) }} />}
    </span>
  );
}

export function IssuesTable({
  groups: initial, query, filters, milestones, projects = [], labels = [], collapsed, onToggle, onSort, register, columns = DEFAULT_ISSUE_COLUMNS, onOpenIssue,
}: {
  groups: IssueGroup[]; query: string; filters: IssueFilters; milestones: Milestone[]; projects?: Project[]; labels?: Label[]; collapsed: Set<string>; onToggle: (key: string) => void; onSort: (by: IssueFilters["orderBy"]) => void; register?: (a: GroupsApplier | null) => void;
  columns?: IssueColumns; onOpenIssue?: (identifier: string, trigger: HTMLElement) => void;
}) {
  const [groups, setGroups] = useState<GroupState[]>(initial);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState<Set<IssueStatus>>(new Set());
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  // Live refresh (TRC-52): the poll swaps in fresh groups; expanded/collapsed state lives in IssuesView, scroll is untouched.
  const inline = useInlineEdit({ onRow: (row) => setGroups((gs) => {
    // Bare edit responses omit list summaries; keep them until the batched live refresh replaces the groups.
    const previous = gs.flatMap((g) => g.items).find((i) => i.id === row.id);
    return upsertRow(gs, { ...row, unresolvedBlockers: row.unresolvedBlockers ?? previous?.unresolvedBlockers });
  }) });
  const editor = { edit: inline.edit, labels };
  const del = useIssueDelete({ onRemove: (row) => setGroups((gs) => removeRow(gs, row.id)), onRestore: (row) => setGroups((gs) => insertRow(gs, row)) });
  const menu: IssueMenuContext = { editor, projects, milestones, onDelete: (row) => void del.deleteIssue(row) };
  useEffect(() => {
    register?.({
      counts: () => countsOf(groupsRef.current),
      apply: (fresh) => {
        if (inline.pending.current > 0 || del.pending.current > 0) return false;
        if (!sameGroups(groupsRef.current, fresh)) setGroups(fresh);
        return true;
      },
    });
    return () => register?.(null);
  }, [register, inline.pending, del.pending]);
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
    <div className="md:min-w-[var(--list-min-width)]" style={{ "--list-min-width": `${586 + (columns.milestone ? 140 : 0) + (columns.estimate ? 44 : 0) + (columns.assignee ? 30 : 0) + (columns.updatedAt ? 60 : 0)}px` } as CSSProperties} aria-busy={pending}>
      {inline.notice && <InlineEditNotice notice={inline.notice} onDismiss={inline.dismiss} />}
      {del.notice}
      <div className="sticky top-0 z-10 hidden h-7 items-center gap-3 border-b bg-background/95 px-4 text-[11px] font-medium text-muted-foreground backdrop-blur md:flex">
        {sortButton("priority", "Priority", "w-[96px]")}
        {sortButton("title", "Title", "flex-1")}
        {columns.milestone && <span className="w-32 shrink-0">Milestone</span>}
        {columns.estimate && <span className="w-8 shrink-0 text-center">Est.</span>}
        {columns.assignee && <span className="w-[22px] shrink-0"><span className="sr-only">Assignee</span></span>}
        {columns.updatedAt && sortButton("updatedAt", "Updated", "w-12 shrink-0 justify-end")}
        <span className="w-5" />
      </div>
      {sections.map((g) => {
        const isCollapsed = collapsed.has(g.key);
        const group = g.status ? groups.find((x) => x.status === g.status) : undefined;
        return (
          <section key={g.key} aria-label={g.status ? STATUS_LABEL[g.status] : g.title}>
            <h2 className="m-0 mx-2 mt-2 mb-1 flex h-9 items-center rounded-lg bg-muted/50 px-2 text-[13px] font-medium md:h-8">
              <button type="button" aria-expanded={!isCollapsed} onClick={() => onToggle(g.key)} className="flex h-full w-full items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {isCollapsed ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
                {g.status ? <StatusIcon status={g.status} /> : filters.groupBy === "priority" ? <PriorityIcon priority={Number(g.raw) as 0} /> : filters.groupBy === "assignee" ? <ActorAvatar who={g.raw === "none" ? null : (g.raw as "you" | "agent")} size={16} /> : null}
                <span>{g.status ? STATUS_LABEL[g.status] : g.title}</span>
                <span className="text-xs font-normal text-muted-foreground" data-testid={`count-${g.key}`}>{g.items.length}{(group ? group.nextCursor : pagedGroups.length > 0) ? "+" : ""}</span>
              </button>
            </h2>
            <div>
              {!isCollapsed && nestRows(g.items).map((t) => {
                const i = t.row;
                const parent = i.parentId ? parentOf.get(i.parentId) : undefined;
                const sub = children.get(i.id);
                return (
                <IssueContextMenu key={i.id} issue={i} menu={menu}>
                {/* Phone: a grid of two lines (status and title / identifier, updated, markers, labels, assignee). From md: one flat flex line, the `md:order-*` classes put the cells in column order. */}
                <div data-depth={t.depth} style={{ "--indent": `${t.depth * INDENT}px` } as CSSProperties} className={ROW}>
                  <Connectors tree={t} />
                  <StatusPicker issue={i} editor={editor} className="col-start-1 row-start-1 mt-px ml-[var(--indent)] md:order-2 md:-mr-1 md:mt-0" />
                  {/* The link's overlay makes the whole row clickable; the pickers sit above it. */}
                  <Link data-issue-identifier={i.identifier} href={`/issues/${i.identifier}`} onClick={(e) => {
                    if (!onOpenIssue || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    onOpenIssue(i.identifier, e.currentTarget);
                  }} className="col-start-2 row-start-1 line-clamp-3 min-w-0 rounded font-medium text-foreground outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring md:order-3 md:block md:flex-1 md:line-clamp-none md:truncate">{i.title}</Link>
                  <div className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] md:contents">
                    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground md:order-1 md:w-[96px]">
                      <PriorityPicker issue={i} editor={editor} />
                      {i.identifier}
                    </span>
                    {columns.updatedAt && <time suppressHydrationWarning dateTime={i.updatedAt} className="shrink-0 text-[11px] text-muted-foreground tabular-nums md:order-[11] md:w-12 md:text-right">{timeAgo(i.updatedAt)}</time>}
                    <BlockerBadge blockers={i.unresolvedBlockers} className="md:order-5" />
                    {t.depth === 0 && i.parentId && (
                      <span data-testid="parent-marker" className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground md:order-4">
                        <CornerDownRight aria-label="Sub-issue of" role="img" className="size-3" />{parent ?? "parent"}
                      </span>
                    )}
                    {sub && (
                      <span data-testid="sub-progress" className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground tabular-nums md:order-4">
                        <ListTree aria-hidden className="size-3" />{sub.done}/{sub.total}<span className="sr-only"> sub-issues done</span>
                      </span>
                    )}
                    <LabelsPicker issue={i} editor={editor} compact className="ml-auto min-w-0 max-w-[220px] md:order-6 md:ml-0 md:shrink-0" />
                    {columns.milestone && <span className="hidden w-32 shrink-0 truncate text-[11px] text-muted-foreground md:order-8 md:block">{i.milestoneId ? milestoneName.get(i.milestoneId) : ""}</span>}
                    {columns.estimate && <span className="hidden w-8 shrink-0 text-center font-mono text-[11px] text-muted-foreground tabular-nums md:order-9 md:block">{i.estimate ?? ""}</span>}
                    {columns.assignee && <AssigneePicker issue={i} editor={editor} quietUnassigned className="shrink-0 md:order-10" />}
                  </div>
                  <IssueMenuButton issue={i} className="max-md:hidden md:order-[12]" />
                </div>
                </IssueContextMenu>
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
    <div className="flex items-center gap-3 border-b border-border/60 px-4 py-1.5">
      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" disabled={loading} onClick={() => onMore(group)}>
        {loading && <Loader2 className="size-3.5 animate-spin" />}
        Load more {STATUS_LABEL[group.status].toLowerCase()}
      </Button>
      {group.error && <span role="alert" className="text-xs text-destructive">{group.error}</span>}
    </div>
  );
}
