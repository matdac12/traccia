import type { IssueStatus } from "@traccia/shared";
import type { IssueRow, Milestone, Project } from "@/lib/api/schemas";
import type { GroupBy, IssueFilters } from "@/lib/issue-filters";

export type Section = { key: string; status?: IssueStatus; title: string; items: IssueRow[] };

type Lookups = { projects: Project[]; milestones: Milestone[] };

const PRIORITY_TITLE: Record<number, string> = { 0: "No priority", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };
const PRIORITY_ORDER = [1, 2, 3, 4, 0];
const ASSIGNEE_TITLE: Record<string, string> = { you: "You", agent: "Agent", none: "Unassigned" };

/** The table's current sort as a comparator (the API sorted each status page; regrouping pools them, so sort again). */
export function compareRows({ orderBy, order }: Pick<IssueFilters, "orderBy" | "order">) {
  const sign = order === "asc" ? 1 : -1;
  const value = (r: IssueRow) => (orderBy === "title" ? r.title : orderBy === "priority" ? r.priority : orderBy === "createdAt" ? r.createdAt : r.updatedAt);
  return (a: IssueRow, b: IssueRow) => {
    const x = value(a);
    const y = value(b);
    return (x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : 1) * sign;
  };
}

/**
 * Splits the loaded rows into the table's sections. Grouped by status the API's own pages are kept as they
 * are (empty ones dropped); any other grouping pools the loaded rows of every status and re-sorts them.
 */
export function buildSections(groups: { status: IssueStatus; items: IssueRow[] }[], groupBy: GroupBy, filters: IssueFilters, lookups: Lookups): Section[] {
  if (groupBy === "status") return groups.filter((g) => g.items.length).map((g) => ({ key: g.status, status: g.status, title: g.status, items: g.items }));
  const rows = groups.flatMap((g) => g.items).sort(compareRows(filters));
  if (groupBy === "none") return rows.length ? [{ key: "all", title: "All issues", items: rows }] : [];
  const keyOf = (i: IssueRow) =>
    groupBy === "priority" ? String(i.priority) : groupBy === "assignee" ? (i.assignee ?? "none") : groupBy === "project" ? i.projectId : (i.milestoneId ?? "none");
  const titles = new Map<string, string>();
  if (groupBy === "priority") PRIORITY_ORDER.forEach((p) => titles.set(String(p), PRIORITY_TITLE[p]!));
  else if (groupBy === "assignee") Object.entries(ASSIGNEE_TITLE).forEach(([k, v]) => titles.set(k, v));
  else if (groupBy === "project") lookups.projects.forEach((p) => titles.set(p.id, p.name));
  else { lookups.milestones.forEach((m) => titles.set(m.id, m.name)); titles.set("none", "No milestone"); }
  const out = new Map<string, IssueRow[]>();
  for (const r of rows) out.set(keyOf(r), [...(out.get(keyOf(r)) ?? []), r]);
  // Keys the lookups do not know (a deleted project) still get a section, after the known ones.
  const keys = [...titles.keys(), ...[...out.keys()].filter((k) => !titles.has(k))];
  return keys.filter((k) => out.has(k)).map((k) => ({ key: k, title: titles.get(k) ?? k, items: out.get(k)! }));
}

/** Finished / total of each parent's loaded sub-issues (a filtered or paged list only knows part of them). */
export function subIssueCounts(rows: IssueRow[]): Map<string, { done: number; total: number }> {
  const out = new Map<string, { done: number; total: number }>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const c = out.get(r.parentId) ?? { done: 0, total: 0 };
    c.total++;
    if (r.status === "done" || r.status === "canceled") c.done++;
    out.set(r.parentId, c);
  }
  return out;
}
