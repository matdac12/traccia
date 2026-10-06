import type { Milestone } from "@/lib/api/schemas";

/** Share of done issues, 0-100 (canceled issues are already excluded from the API's `total`). */
export function progressPercent(progress: Milestone["progress"]): number {
  if (!progress || progress.total === 0) return 0;
  return Math.round((progress.done / progress.total) * 100);
}

export type MilestoneState = "not_started" | "in_progress" | "done";

/** Dot semantics: nothing done (or no issues) is not started, everything done is done, anything between is in progress. */
export function milestoneState(progress: Milestone["progress"]): MilestoneState {
  const percent = progressPercent(progress);
  if (!progress || progress.total === 0 || progress.done === 0) return "not_started";
  // `done === total` already rounds to 100%, so the percent check alone decides "done".
  return percent >= 100 ? "done" : "in_progress";
}

/** Roll-up of every milestone's issues, for the overview's progress summary. Issues outside any milestone are not counted. */
export function summarizeProgress(milestones: Milestone[]) {
  let done = 0;
  let total = 0;
  let milestonesDone = 0;
  for (const m of milestones) {
    done += m.progress?.done ?? 0;
    total += m.progress?.total ?? 0;
    if (milestoneState(m.progress) === "done") milestonesDone++;
  }
  return { done, total, percent: progressPercent({ done, total }), milestones: milestones.length, milestonesDone };
}
