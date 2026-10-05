import { StatusIcon } from "@/components/traccia/atoms";
import type { IssueStatus } from "@traccia/shared";
import Link from "next/link";
import type { Milestone } from "@/lib/api/schemas";
import { formatTargetDate, milestoneState, progressPercent, type MilestoneState } from "./milestone-progress";

/** The dot reuses the issue status icons: empty ring, half pie, check. */
const DOT_STATUS: Record<MilestoneState, IssueStatus> = { not_started: "todo", in_progress: "in_progress", done: "done" };
const DOT_LABEL: Record<MilestoneState, string> = { not_started: "Not started", in_progress: "In progress", done: "Done" };

/**
 * One readable line per milestone, like Linear's project overview: status dot, name, percent, issue count, and
 * the description (one line) with the target date underneath. The name links to the project's issues filtered to
 * this milestone; the link stretches over the whole row (`after:inset-0`), so controls placed in the row need
 * `relative z-10`. Pure markup, shared by the panel and tests.
 */
export function MilestoneRow({ milestone, href }: { milestone: Milestone; href: string }) {
  const done = milestone.progress?.done ?? 0;
  const total = milestone.progress?.total ?? 0;
  const percent = progressPercent(milestone.progress);
  const state = milestoneState(milestone.progress);
  const target = formatTargetDate(milestone.targetDate);
  const description = milestone.description?.trim();
  const meta = [description, target ? `Target ${target}` : null].filter(Boolean);
  return (
    <>
      <span title={DOT_LABEL[state]} data-state={state} data-testid="milestone-dot" className="mt-0.5 shrink-0 self-start">
        <StatusIcon status={DOT_STATUS[state]} className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <Link href={href} className="block truncate rounded text-[13px] font-medium outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring">{milestone.name}</Link>
        {meta.length ? <p className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</p> : null}
      </div>
      <div className="flex shrink-0 items-baseline gap-2 text-xs tabular-nums text-muted-foreground">
        <span className="text-foreground">{percent}%</span>
        <span>{done}/{total} issues</span>
      </div>
    </>
  );
}
