import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MilestoneRow } from "../components/project/milestone-row";
import { formatTargetDate, milestoneState, progressPercent, summarizeProgress } from "../components/project/milestone-progress";
import type { Milestone } from "../lib/api/schemas";

const base: Milestone = { id: "m1", projectId: "p", name: "Beta", description: "", targetDate: "2026-03-09", updatedAt: "2026-01-01T00:00:00.000Z", progress: { done: 3, total: 4 } };

describe("milestone progress", () => {
  it("computes a rounded percent and guards empty milestones", () => {
    expect(progressPercent({ done: 1, total: 3 })).toBe(33);
    expect(progressPercent({ done: 0, total: 0 })).toBe(0);
    expect(progressPercent(undefined)).toBe(0);
  });
  it("formats the target date without timezone drift", () => {
    expect(formatTargetDate("2026-03-09")).toBe("9 Mar 2026");
    expect(formatTargetDate(null)).toBeNull();
  });
  it("maps progress to the dot state: done 100%, in progress partial, not started 0%", () => {
    expect(milestoneState({ done: 4, total: 4 })).toBe("done");
    expect(milestoneState({ done: 1, total: 4 })).toBe("in_progress");
    expect(milestoneState({ done: 0, total: 4 })).toBe("not_started");
    expect(milestoneState({ done: 0, total: 0 })).toBe("not_started");
    expect(milestoneState(undefined)).toBe("not_started");
  });
  it("rolls milestones up for the overview summary", () => {
    const m = (done: number, total: number) => ({ ...base, progress: { done, total } });
    expect(summarizeProgress([m(4, 4), m(1, 4), m(0, 2)])).toEqual({ done: 5, total: 10, percent: 50, milestones: 3, milestonesDone: 1 });
    expect(summarizeProgress([])).toMatchObject({ total: 0, percent: 0, milestones: 0 });
  });
  it("renders name, percent, issue count, one-line description and the target date as a row", () => {
    const html = renderToStaticMarkup(<MilestoneRow milestone={{ ...base, description: "Public beta" }} href="/projects/p/issues?milestone=m1" />);
    expect(html).toContain("Beta");
    expect(html).toContain("75%");
    expect(html).toContain("3/4 issues");
    expect(html).toContain("Public beta · Target 9 Mar 2026");
    expect(html).toContain('href="/projects/p/issues?milestone=m1"');
    expect(html).toContain('data-state="in_progress"');
  });
  it("renders a milestone without issues, description or date without placeholder noise", () => {
    const html = renderToStaticMarkup(<MilestoneRow milestone={{ ...base, targetDate: null, progress: { done: 0, total: 0 } }} href="/x" />);
    expect(html).toContain("0/0 issues");
    expect(html).toContain('data-state="not_started"');
    expect(html).not.toContain("No target date");
    expect(html).not.toContain("<p");
  });
});
