"use client";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { GroupBy, IssueFilters } from "@/lib/issue-filters";

export const GROUP_LABEL: Record<GroupBy, string> = { status: "Status", none: "None", priority: "Priority", assignee: "Assignee", project: "Project", milestone: "Milestone" };
export const SORT_LABEL: Partial<Record<IssueFilters["orderBy"], string>> = { priority: "Priority", updatedAt: "Updated", createdAt: "Created", title: "Title" };

/** Table display options: how rows are grouped and which field they are sorted by. */
export function DisplayMenu({ filters, onChange, hideProject = false }: { filters: IssueFilters; onChange: (next: IssueFilters) => void; hideProject?: boolean }) {
  const groups = (Object.keys(GROUP_LABEL) as GroupBy[]).filter((g) => !(hideProject && g === "project"));
  const sorts = Object.keys(SORT_LABEL) as IssueFilters["orderBy"][];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[13px] text-muted-foreground"><SlidersHorizontal className="size-3.5" />Display</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Group by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={filters.groupBy} onValueChange={(v) => onChange({ ...filters, groupBy: v as GroupBy })}>
          {groups.map((g) => <DropdownMenuRadioItem key={g} value={g} className="text-[13px]">{GROUP_LABEL[g]}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={filters.orderBy} onValueChange={(v) => onChange({ ...filters, orderBy: v as IssueFilters["orderBy"] })}>
          {sorts.map((s) => <DropdownMenuRadioItem key={s} value={s} className="text-[13px]">{SORT_LABEL[s]}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
