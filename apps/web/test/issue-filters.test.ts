import { describe, expect, it } from "vitest";
import { activeFilterCount, clearFilters, DEFAULT_FILTERS, filtersToApiQuery, filtersToSearchParams, parseFilters, visibleStatuses } from "../lib/issue-filters";

describe("issue filters", () => {
  it("round-trips through the URL and keeps defaults out of it", () => {
    expect(filtersToSearchParams(DEFAULT_FILTERS).toString()).toBe("");
    const f = parseFilters(new URLSearchParams("project=p1&assignee=agent&label=bug&label=ui&priority=0&milestone=m1&q=hello&sort=priority&order=asc&view=kanban&status=todo&status=done&group=priority"));
    expect(f).toEqual({ project: "p1", status: ["todo", "done"], groupBy: "priority", assignee: "agent", labels: ["bug", "ui"], priority: 0, milestone: "m1", q: "hello", orderBy: "priority", order: "asc", view: "kanban" });
    expect(parseFilters(filtersToSearchParams(f))).toEqual(f);
  });
  it("drops invalid values instead of failing", () => {
    const f = parseFilters({ assignee: "bob", priority: "9", sort: "bogus", order: "up", view: "grid", group: "x", status: ["nope", "todo", "todo"], label: ["a", "a", " "] });
    expect(f).toEqual({ ...DEFAULT_FILTERS, labels: ["a"], status: ["todo"] });
  });
  it("accepts Next's searchParams object", () => {
    expect(parseFilters({ label: ["x", "y"], q: "z" })).toMatchObject({ labels: ["x", "y"], q: "z" });
  });
  it("maps to the API query", () => {
    const q = filtersToApiQuery({ ...DEFAULT_FILTERS, labels: ["a"], q: "  hi ", assignee: "none" });
    expect(q).toMatchObject({ label: ["a"], q: "hi", assignee: "none", orderBy: "updatedAt", order: "desc" });
    expect(filtersToApiQuery(DEFAULT_FILTERS)).toMatchObject({ label: undefined, q: undefined });
  });
  it("counts narrowing filters and clears them but keeps sort and view", () => {
    const f = { ...DEFAULT_FILTERS, project: "p", labels: ["a", "b"], q: "x", orderBy: "priority" as const, view: "kanban" as const };
    expect(activeFilterCount(f)).toBe(4);
    expect(clearFilters(f)).toEqual({ ...DEFAULT_FILTERS, orderBy: "priority", view: "kanban" });
  });
  it("keeps status in workflow order, counts it, and lists only the chosen statuses", () => {
    const f = parseFilters(new URLSearchParams("status=done&status=backlog"));
    expect(f.status).toEqual(["backlog", "done"]);
    expect(activeFilterCount(f)).toBe(2);
    expect(visibleStatuses(f)).toEqual(["backlog", "done"]);
    expect(visibleStatuses(DEFAULT_FILTERS)).toHaveLength(6);
    expect(filtersToSearchParams({ ...DEFAULT_FILTERS, groupBy: "none", orderBy: "title" }).toString()).toBe("sort=title&group=none");
    expect(clearFilters({ ...f, groupBy: "assignee" })).toEqual({ ...DEFAULT_FILTERS, groupBy: "assignee" });
  });
});
