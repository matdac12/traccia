import type { Priority } from "@traccia/shared";
import { Minus, SignalHigh, SignalLow, SignalMedium, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export const PRIORITY_LABEL: Record<Priority, string> = { 0: "No priority", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const cls = cn("size-3.5 shrink-0 text-muted-foreground", className);
  const label = { "aria-label": PRIORITY_LABEL[priority], role: "img" } as const;
  if (priority === 1) return <TriangleAlert {...label} className={cn(cls, "text-[#e5646a]")} />;
  if (priority === 2) return <SignalHigh {...label} className={cls} />;
  if (priority === 3) return <SignalMedium {...label} className={cls} />;
  if (priority === 4) return <SignalLow {...label} className={cls} />;
  return <Minus {...label} className={cn(cls, "opacity-50")} />;
}
