import { Bot, Check, Minus, SignalHigh, SignalLow, SignalMedium, TriangleAlert, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LABELS, type Actor, type Priority, type Status } from "@/lib/mock-data";

const STATUS_COLOR: Record<Status, string> = {
  backlog: "var(--st-backlog)",
  todo: "var(--st-todo)",
  in_progress: "var(--st-progress)",
  in_review: "var(--st-review)",
  done: "var(--st-done)",
  canceled: "var(--st-canceled)",
};

export function StatusIcon({ status, className }: { status: Status; className?: string }) {
  const c = STATUS_COLOR[status];
  const common = { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", className: cn("shrink-0", className) };
  switch (status) {
    case "backlog":
      return <svg {...common}><circle cx="7" cy="7" r="5.75" stroke={c} strokeWidth="1.5" strokeDasharray="1.8 1.8" /></svg>;
    case "todo":
      return <svg {...common}><circle cx="7" cy="7" r="5.75" stroke={c} strokeWidth="1.5" /></svg>;
    case "in_progress":
      return <svg {...common}><circle cx="7" cy="7" r="5.75" stroke={c} strokeWidth="1.5" /><path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill={c} /></svg>;
    case "in_review":
      return <svg {...common}><circle cx="7" cy="7" r="5.75" stroke={c} strokeWidth="1.5" /><path d="M7 3.5a3.5 3.5 0 1 1-3.5 3.5L7 7z" fill={c} /></svg>;
    case "done":
      return <svg {...common}><circle cx="7" cy="7" r="6.5" fill={c} /><path d="M4.4 7.2l1.9 1.9 3.3-3.8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "canceled":
      return <svg {...common}><circle cx="7" cy="7" r="6.5" fill={c} /><path d="M4.8 4.8l4.4 4.4M9.2 4.8L4.8 9.2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  }
}

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const cls = cn("size-3.5 shrink-0 text-muted-foreground", className);
  if (priority === 1) return <TriangleAlert className={cn(cls, "text-[#e5646a]")} />;
  if (priority === 2) return <SignalHigh className={cls} />;
  if (priority === 3) return <SignalMedium className={cls} />;
  if (priority === 4) return <SignalLow className={cls} />;
  return <Minus className={cn(cls, "opacity-50")} />;
}

export function Assignee({ who, size = 18, showName }: { who: Actor | null; size?: number; showName?: boolean }) {
  const inner =
    who === "agent" ? (
      <span className="grid place-items-center rounded-full bg-agent/15 text-agent ring-1 ring-agent/30" style={{ width: size, height: size }}>
        <Bot style={{ width: size * 0.62, height: size * 0.62 }} />
      </span>
    ) : who === "you" ? (
      <span className="grid place-items-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary ring-1 ring-primary/30" style={{ width: size, height: size }}>
        M
      </span>
    ) : (
      <span className="grid place-items-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/60" style={{ width: size, height: size }}>
        <User style={{ width: size * 0.6, height: size * 0.6 }} />
      </span>
    );
  if (!showName) return inner;
  return (
    <span className="inline-flex items-center gap-1.5">
      {inner}
      <span className="text-[13px]">{who === "agent" ? "Agent" : who === "you" ? "You" : "Unassigned"}</span>
    </span>
  );
}

export function LabelChip({ name }: { name: string }) {
  const color = LABELS.find((l) => l.name === name)?.color ?? "#8a8f98";
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[11px] text-muted-foreground">
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}

export function AgentMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-agent/12 px-1.5 py-px text-[10px] font-medium text-agent", className)}>
      <Bot className="size-2.5" /> agent
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>;
}

export { Check, X };
