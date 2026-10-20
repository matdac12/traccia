"use client";
import { Link2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { IssueRow } from "@/lib/api/schemas";

/** Compact list summaries only: never load issue details per row. */
export function BlockerBadge({ blockers, className = "" }: { blockers: IssueRow["unresolvedBlockers"]; className?: string }) {
  const unresolved = blockers ?? [];
  if (!unresolved.length) return null;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Blocked by ${unresolved.map((b) => `${b.identifier}: ${b.title}`).join("; ")}`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className={`relative z-[1] inline-flex shrink-0 items-center gap-1 rounded border border-orange-500/25 bg-orange-500/10 px-1.5 py-0.5 text-[11px] text-orange-700 outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-orange-400 ${className}`}
          >
            <Link2 aria-hidden className="size-3" />
            {unresolved.length === 1 ? unresolved[0]!.identifier : `${unresolved.length} blockers`}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs" side="top" sideOffset={4}>
          <ul className="space-y-1">
            {unresolved.map((b) => (
              <li key={b.id}>
                <span className="font-mono">{b.identifier}</span>: {b.title}
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
