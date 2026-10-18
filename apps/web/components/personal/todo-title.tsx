"use client";
import type { Todo } from "@traccia/shared";
import Link from "next/link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { titleSegments } from "@/lib/personal/title";
import { cn } from "@/lib/utils";
import { useProjectOptions } from "./projects-context";

export const CHIP = "mx-px inline-flex translate-y-[-1px] items-center rounded-[4px] border bg-surface px-1 align-middle font-mono text-[10.5px] font-medium leading-4 tracking-wide text-foreground/80";

/**
 * A Project key as a chip. With a `projectId` it links to the Project page, with an "Open <name>" tooltip; a click
 * stays on the chip, so it never selects the row under it. A deleted Project's chip is greyed and not a link.
 */
export function ProjectChip({ projectKey, projectId, deleted = false }: { projectKey: string; projectId?: string; deleted?: boolean }) {
  const projects = useProjectOptions();
  if (deleted || !projectId) {
    return (
      <span className={cn(CHIP, deleted && "border-dashed text-muted-foreground/60")} title={deleted ? `${projectKey} is deleted` : undefined}>
        {projectKey}
      </span>
    );
  }
  const name = projects.find((p) => p.id === projectId)?.name ?? projectKey;
  // The tooltip uses the app's TooltipProvider (root layout), with its delay.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={`/projects/${projectId}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(CHIP, "relative z-[1] transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
        >
          {projectKey}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        Open {name}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The title with its Project chips, linked unless `linked` is false (quick add's read-back). A done or dropped
 * To-do gets a 1.5 px accent line through it, drawn as a background so it can grow from the left (the Personal
 * Space's signature, docs/personal-space.md §7.4); no transition under reduced motion.
 */
export function TodoTitle({ todo, linked = true, className }: { todo: Pick<Todo, "title" | "references" | "state">; linked?: boolean; className?: string }) {
  const closed = todo.state !== "open";
  return (
    <span className={cn("min-w-0", closed && "text-muted-foreground", className)}>
      <span
        data-struck={closed || undefined}
        className="bg-no-repeat transition-[background-size] duration-300 ease-out [box-decoration-break:clone] motion-reduce:transition-none"
        style={{ backgroundImage: "linear-gradient(var(--brand), var(--brand))", backgroundPosition: "0 58%", backgroundSize: closed ? "100% 1.5px" : "0% 1.5px" }}
      >
        {titleSegments(todo.title, todo.references).map((s, i) =>
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder.
          "key" in s ? <ProjectChip key={i} projectKey={s.key} projectId={linked ? s.projectId : undefined} deleted={s.projectDeleted} /> : <span key={i}>{s.text}</span>,
        )}
      </span>
    </span>
  );
}
