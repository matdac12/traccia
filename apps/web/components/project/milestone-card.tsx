import { CalendarDays } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { Milestone } from "@/lib/api/schemas";
import { formatTargetDate, progressPercent } from "./milestone-progress";

/** Name, percent, progress bar, done/total and target date. Pure markup, shared by the panel and tests. */
export function MilestoneSummary({ milestone }: { milestone: Milestone }) {
  const done = milestone.progress?.done ?? 0;
  const total = milestone.progress?.total ?? 0;
  const percent = progressPercent(milestone.progress);
  const target = formatTargetDate(milestone.targetDate);
  return (
    <>
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-medium">{milestone.name}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{percent}%</span>
      </div>
      <Progress value={percent} aria-label={`${milestone.name} progress`} className="mt-2 h-1" />
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="tabular-nums">{done}/{total} issues</span>
        {target ? <span className="flex items-center gap-1"><CalendarDays className="size-3" />{target}</span> : <span>No target date</span>}
      </div>
    </>
  );
}
