import { describe, expect, it } from "vitest";
import { activeFilterCount, clearFilters, DEFAULT_FILTERS, filtersToApiQuery, filtersToSearchParams, parseFilters } from "../lib/issue-filters";

describe("issue filters", () => {
  it("round-trips through the URL and keeps defaults out of it", () => {
    expect(filtersToSearchParams(DEFAULT_FILTERS).toString()).toBe("");
    const f = parseFilters(new URLSearchParams("project=p1&assignee=agent&label=bug&label=ui&priority=0&milestone=m1&q=hello&sort=priority&order=asc&view=kanban"));
    expect(f).toEqual({ project: "p1", assignee: "agent", labels: ["bug", "ui"], priority: 0, milestone: "m1", q: "hello", orderBy: "priority", order: "asc", view: "kanban" });
    expect(parseFilters(filtersToSearchParams(f))).toEqual(f);
  });
  it("drops invalid values instead of failing", () => {
    const f = parseFilters({ assignee: "bob", priority: "9", sort: "title", order: "up", view: "grid", label: ["a", "a", " "] });
    expect(f).toEqual({ ...DEFAULT_FILTERS, labels: ["a"] });
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
});
