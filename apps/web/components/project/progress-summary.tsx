import { Progress } from "@/components/ui/progress";
import type { Milestone } from "@/lib/api/schemas";
import { summarizeProgress } from "./milestone-progress";

/** Overview "Progress": all milestone issues rolled up. Hidden when there is nothing to count (no empty strip). */
export function ProgressSummary({ milestones }: { milestones: Milestone[] }) {
  const s = summarizeProgress(milestones);
  if (s.total === 0) return null;
  return (
    <section aria-label="Progress">
      <h2 className="mb-2 h-6 text-[13px] font-medium leading-6">Progress</h2>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight">{s.percent}%</span>
        <span className="text-xs tabular-nums text-muted-foreground">{s.done}/{s.total} issues done</span>
      </div>
      <Progress value={s.percent} aria-label="Project progress" className="mt-2 h-1" />
      <p className="mt-2 text-xs tabular-nums text-muted-foreground">{s.milestonesDone} of {s.milestones} milestones complete</p>
    </section>
  );
}
