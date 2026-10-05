"use client";
import type { IssueStatus } from "@linear-matti/shared";
import { Columns3, Rows3 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ListTodo, SearchX, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/traccia/empty-state";
import { Button } from "@/components/ui/button";
import type { Label, Milestone, Project } from "@/lib/api/schemas";
import { activeFilterCount, clearFilters, filtersToSearchParams, type IssueFilters } from "@/lib/issue-filters";
import { Board } from "@/components/kanban/board";
import { ActiveChips, FilterMenu, SearchBox } from "./filter-bar";
import { COLLAPSED_BY_DEFAULT, IssuesTable, type IssueGroup } from "./issues-table";

export type IssuesData = { groups: IssueGroup[]; projects: Project[]; labels: Label[]; milestones: Milestone[] };

/** `lockProject`: embedded in a project page, where `filters.project` is fixed and the project filter is hidden. */
export function IssuesView({ filters, data, error, lockProject = false, title = "Issues" }: { filters: IssueFilters; data?: IssuesData; error?: string; lockProject?: boolean; title?: string }) {
  const router = useRouter();
  const path = usePathname();
  const [pending, startTransition] = useTransition();
  // Kept here so re-sorting (which reloads the groups) does not re-collapse what the user opened.
  const [collapsed, setCollapsed] = useState<Set<IssueStatus>>(new Set(COLLAPSED_BY_DEFAULT));
  const query = filtersToSearchParams(filters).toString();
  const go = (next: IssueFilters) => {
    const qs = filtersToSearchParams(next).toString();
    startTransition(() => router.replace(qs ? `${path}?${qs}` : path, { scroll: false }));
  };
  const lookups = data ?? { projects: [], labels: [], milestones: [] };
  const shown = data?.groups.reduce((n, g) => n + g.items.length, 0) ?? 0;
  const more = data?.groups.some((g) => g.nextCursor);
  const filtered = activeFilterCount(lockProject ? { ...filters, project: undefined } : filters) > 0;
  const clear = () => go(lockProject ? { ...clearFilters(filters), project: filters.project } : clearFilters(filters));

  const viewButton = (view: IssueFilters["view"], text: string, icon: React.ReactNode) => (
    <Button type="button" size="sm" variant={filters.view === view ? "secondary" : "ghost"} aria-pressed={filters.view === view} onClick={() => go({ ...filters, view })} className="h-7 gap-1.5 px-2 text-xs">
      {icon}{text}
    </Button>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <h1 className="text-[13px] font-medium">{title}</h1>
        {data && <span className="text-xs text-muted-foreground" data-testid="total">{shown}{more ? "+" : ""}</span>}
        <div className="mx-2 h-4 w-px bg-border" />
        <FilterMenu filters={filters} lookups={lookups} onChange={go} hideProject={lockProject} />
        <SearchBox value={filters.q} onSearch={(q) => go({ ...filters, q })} />
        <div className="ml-auto flex items-center gap-1 rounded-md border p-0.5" role="group" aria-label="View">
          {viewButton("table", "Table", <Rows3 className="size-3.5" />)}
          {viewButton("kanban", "Board", <Columns3 className="size-3.5" />)}
        </div>
      </header>
      <ActiveChips filters={filters} lookups={lookups} onChange={go} hideProject={lockProject} />
      <div className={`min-h-0 flex-1 overflow-auto transition-opacity ${pending ? "opacity-60" : ""}`}>
        {error ? (
          <EmptyState icon={TriangleAlert} title="Could not load issues">{error}</EmptyState>
        ) : !data ? null : filters.view === "kanban" ? (
          <Board key={query} columns={data.groups} query={query} />
        ) : shown === 0 ? (
          filtered ? (
            <EmptyState icon={SearchX} title="No issues match">
              Try removing a filter or changing your search.
              <span className="mt-3 block"><Button type="button" size="sm" variant="outline" onClick={clear}>Clear filters</Button></span>
            </EmptyState>
          ) : (
            <EmptyState icon={ListTodo} title="No issues yet">Create an issue from the API, MCP or the CLI and it shows up here.</EmptyState>
          )
        ) : (
          <IssuesTable key={query} groups={data.groups} collapsed={collapsed} onToggle={(s) => setCollapsed((c) => { const n = new Set(c); if (!n.delete(s)) n.add(s); return n; })} query={query} filters={filters} milestones={lookups.milestones} onSort={(by) => go({ ...filters, orderBy: by, order: filters.orderBy === by && filters.order === "desc" ? "asc" : "desc" })} />
        )}
      </div>
    </div>
  );
}
