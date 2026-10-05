import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MilestoneSummary } from "../components/project/milestone-card";
import { formatTargetDate, progressPercent } from "../components/project/milestone-progress";
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
  it("renders done/total, percent and the target date", () => {
    const html = renderToStaticMarkup(<MilestoneSummary milestone={base} />);
    expect(html).toContain("3/4 issues");
    expect(html).toContain("75%");
    expect(html).toContain("9 Mar 2026");
    expect(html).toContain('aria-valuenow="75"');
  });
  it("renders a milestone without issues or date", () => {
    const html = renderToStaticMarkup(<MilestoneSummary milestone={{ ...base, targetDate: null, progress: { done: 0, total: 0 } }} />);
    expect(html).toContain("0/0 issues");
    expect(html).toContain("No target date");
  });
});
