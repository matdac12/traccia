"use client";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { COLUMN_LABEL, DEFAULT_ISSUE_COLUMNS, type IssueColumns } from "./columns";
import type { GroupBy, IssueFilters } from "@/lib/issue-filters";

export const GROUP_LABEL: Record<GroupBy, string> = { status: "Status", none: "None", priority: "Priority", assignee: "Assignee", project: "Project", milestone: "Milestone" };
export const SORT_LABEL: Partial<Record<IssueFilters["orderBy"], string>> = { priority: "Priority", updatedAt: "Updated", createdAt: "Created", title: "Title" };

/** Grouping and sorting always work; column controls are opt-in for list parents. */
export function DisplayMenu({
  filters,
  onChange,
  hideProject = false,
  columns = DEFAULT_ISSUE_COLUMNS,
  onColumnsChange,
  showSubIssues = true,
  onShowSubIssuesChange,
}: {
  filters: IssueFilters;
  onChange: (next: IssueFilters) => void;
  hideProject?: boolean;
  columns?: IssueColumns;
  onColumnsChange?: (next: IssueColumns) => void;
  showSubIssues?: boolean;
  onShowSubIssuesChange?: (next: boolean) => void;
}) {
  const groups = (Object.keys(GROUP_LABEL) as GroupBy[]).filter((g) => !(hideProject && g === "project"));
  const sorts = Object.keys(SORT_LABEL) as IssueFilters["orderBy"][];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-issue-list-focus variant="ghost" size="sm" className="h-7 gap-1.5 text-[13px] text-muted-foreground">
          <SlidersHorizontal className="size-3.5" />
          Display
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Group by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={filters.groupBy} onValueChange={(v) => onChange({ ...filters, groupBy: v as GroupBy })}>
          {groups.map((g) => (
            <DropdownMenuRadioItem key={g} value={g} className="text-[13px]">
              {GROUP_LABEL[g]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={filters.orderBy} onValueChange={(v) => onChange({ ...filters, orderBy: v as IssueFilters["orderBy"] })}>
          {sorts.map((s) => (
            <DropdownMenuRadioItem key={s} value={s} className="text-[13px]">
              {SORT_LABEL[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {onShowSubIssuesChange && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Sub-issues</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={showSubIssues} onCheckedChange={(checked) => onShowSubIssuesChange(checked === true)} onSelect={(e) => e.preventDefault()} className="text-[13px]">
              Show sub-issues
            </DropdownMenuCheckboxItem>
          </>
        )}
        {onColumnsChange && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Columns</DropdownMenuLabel>
            {(Object.keys(COLUMN_LABEL) as (keyof IssueColumns)[]).map((key) => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={columns[key]}
                onCheckedChange={(checked) => onColumnsChange({ ...columns, [key]: checked === true })}
                onSelect={(e) => e.preventDefault()}
                className="text-[13px]"
              >
                {COLUMN_LABEL[key]}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
