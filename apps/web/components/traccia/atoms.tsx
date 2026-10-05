import type { Actor, IssueStatus } from "@linear-matti/shared";
import { Bot, User } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Status colors are fixed tokens (--st-*), independent of the user accent. */
const STATUS_COLOR: Record<IssueStatus, string> = {
  backlog: "var(--st-backlog)",
  todo: "var(--st-todo)",
  in_progress: "var(--st-progress)",
  in_review: "var(--st-review)",
  done: "var(--st-done)",
  canceled: "var(--st-canceled)",
};

export const STATUS_LABEL: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

export function StatusIcon({ status, className }: { status: IssueStatus; className?: string }) {
  const c = STATUS_COLOR[status];
  const common = { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", className: cn("shrink-0", className), "aria-label": STATUS_LABEL[status], role: "img" } as const;
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

/** Agent identity: cyan bot avatar. Humans (`you`) get an initial avatar. */
export function ActorAvatar({ who, size = 18, initial = "Y" }: { who: Actor | null; size?: number; initial?: string }) {
  if (who === "agent")
    return (
      <span className="grid place-items-center rounded-full bg-agent/15 text-agent ring-1 ring-agent/30" style={{ width: size, height: size }}>
        <Bot style={{ width: size * 0.62, height: size * 0.62 }} />
      </span>
    );
  if (who === "you")
    return (
      <span className="grid place-items-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary ring-1 ring-primary/30" style={{ width: size, height: size }}>
        {initial}
      </span>
    );
  return (
    <span className="grid place-items-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/60" style={{ width: size, height: size }}>
      <User style={{ width: size * 0.6, height: size * 0.6 }} />
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

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>;
}
