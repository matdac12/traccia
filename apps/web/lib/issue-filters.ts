import { ACTORS, ISSUE_ORDER_BYS, PRIORITIES, type Actor, type IssueOrderBy, type Priority } from "@traccia/shared";

/**
 * Filter, sort and view state of the issues page. It lives in the URL (`?project=&label=...`) so views are
 * shareable and survive a reload; this module is the single place that reads and writes it. The table (MAT-1720)
 * and the Kanban board (MAT-1724) both use it. Pure: safe in server and client components.
 */

export type AssigneeFilter = Actor | "none";
export type IssueView = "table" | "kanban";
export type SortOrder = "asc" | "desc";

export type IssueFilters = {
  project?: string;
  assignee?: AssigneeFilter;
  /** Label names; an issue must have ALL of them (API semantics). */
  labels: string[];
  priority?: Priority;
  /** Milestone id. */
  milestone?: string;
  q: string;
  orderBy: IssueOrderBy;
  order: SortOrder;
  view: IssueView;
};

export const DEFAULT_FILTERS: IssueFilters = { labels: [], q: "", orderBy: "updatedAt", order: "desc", view: "table" };

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

function all(raw: RawParams, key: string): string[] {
  if (raw instanceof URLSearchParams) return raw.getAll(key);
  const v = raw[key];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** Lenient: unknown or invalid values fall back to the default instead of failing the page. */
export function parseFilters(raw: RawParams): IssueFilters {
  const one = (key: string) => all(raw, key)[0]?.trim() || undefined;
  const assignee = one("assignee");
  const priority = Number(one("priority"));
  const orderBy = one("sort");
  const order = one("order");
  return {
    project: one("project"),
    assignee: assignee && [...ACTORS, "none"].includes(assignee) ? (assignee as AssigneeFilter) : undefined,
    labels: [...new Set(all(raw, "label").map((l) => l.trim()).filter(Boolean))],
    priority: one("priority") !== undefined && (PRIORITIES as readonly number[]).includes(priority) ? (priority as Priority) : undefined,
    milestone: one("milestone"),
    q: one("q") ?? "",
    orderBy: orderBy && (ISSUE_ORDER_BYS as readonly string[]).includes(orderBy) ? (orderBy as IssueOrderBy) : DEFAULT_FILTERS.orderBy,
    order: order === "asc" ? "asc" : "desc",
    view: one("view") === "kanban" ? "kanban" : "table",
  };
}

/** Defaults are omitted so the URL of an unfiltered view stays clean. */
export function filtersToSearchParams(f: IssueFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.project) p.set("project", f.project);
  if (f.assignee) p.set("assignee", f.assignee);
  for (const l of f.labels) p.append("label", l);
  if (f.priority !== undefined) p.set("priority", String(f.priority));
  if (f.milestone) p.set("milestone", f.milestone);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.orderBy !== DEFAULT_FILTERS.orderBy) p.set("sort", f.orderBy);
  if (f.order !== DEFAULT_FILTERS.order) p.set("order", f.order);
  if (f.view !== DEFAULT_FILTERS.view) p.set("view", f.view);
  return p;
}

/** Query for `GET /v1/issues` (without status/limit/cursor, which the caller adds). */
export function filtersToApiQuery(f: IssueFilters) {
  return {
    project: f.project,
    assignee: f.assignee,
    label: f.labels.length ? f.labels : undefined,
    priority: f.priority,
    milestone: f.milestone,
    q: f.q.trim() || undefined,
    orderBy: f.orderBy,
    order: f.order,
  };
}

/** Number of narrowing filters (search counts, sort and view do not). */
export function activeFilterCount(f: IssueFilters): number {
  return [f.project, f.assignee, f.priority, f.milestone].filter((v) => v !== undefined).length + f.labels.length + (f.q.trim() ? 1 : 0);
}

export function clearFilters(f: IssueFilters): IssueFilters {
  return { ...DEFAULT_FILTERS, orderBy: f.orderBy, order: f.order, view: f.view };
}
