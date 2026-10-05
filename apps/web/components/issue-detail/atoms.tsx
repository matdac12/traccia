import { Minus, SignalHigh, SignalLow, SignalMedium, TriangleAlert } from "lucide-react";
import { timeAgo } from "@/lib/issue-detail/time";
import { cn } from "@/lib/utils";

export const PRIORITY_OPTIONS = [
  { value: 0, label: "No priority" },
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Low" },
] as const;

export function PriorityIcon({ priority, className }: { priority: number; className?: string }) {
  const cls = cn("size-3.5 shrink-0 text-muted-foreground", className);
  if (priority === 1) return <TriangleAlert className={cn(cls, "text-[#e5646a]")} />;
  if (priority === 2) return <SignalHigh className={cls} />;
  if (priority === 3) return <SignalMedium className={cls} />;
  if (priority === 4) return <SignalLow className={cls} />;
  return <Minus className={cn(cls, "opacity-50")} />;
}

export function LabelChip({ name, color }: { name: string; color?: string }) {
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[11px] text-muted-foreground">
      <span className="size-1.5 rounded-full" style={{ background: color ?? "#8a8f98" }} />
      {name}
    </span>
  );
}

/** Relative time. Server and client clocks differ, so hydration warnings are expected and harmless. */
export function TimeAgo({ iso, suffix = "" }: { iso: string; suffix?: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()} suppressHydrationWarning>
      {timeAgo(iso)}
      {suffix}
    </time>
  );
}
