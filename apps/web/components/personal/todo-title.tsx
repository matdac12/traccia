import type { Todo } from "@traccia/shared";
import { titleSegments } from "@/lib/personal/title";
import { cn } from "@/lib/utils";

const CHIP = "mx-px inline-flex translate-y-[-1px] items-center rounded-[4px] border bg-surface px-1 align-middle font-mono text-[10.5px] font-medium leading-4 tracking-wide text-foreground/80";

/** A Project reference in a title. Greyed when the Project is deleted. Not a link yet (TRC-160). */
export function ProjectChip({ projectKey, deleted = false }: { projectKey: string; deleted?: boolean }) {
  return (
    <span className={cn(CHIP, deleted && "border-dashed text-muted-foreground/60")} title={deleted ? `${projectKey} is deleted` : undefined}>
      {projectKey}
    </span>
  );
}

/**
 * The title with its Project chips. A done or dropped To-do gets a 1.5 px accent line through it, drawn as a
 * background so it can grow from the left (the Personal Space's signature, docs/personal-space.md §7.4); no
 * transition under reduced motion.
 */
export function TodoTitle({ todo, className }: { todo: Pick<Todo, "title" | "references" | "state">; className?: string }) {
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
          "key" in s ? <ProjectChip key={i} projectKey={s.key} deleted={s.projectDeleted} /> : <span key={i}>{s.text}</span>,
        )}
      </span>
    </span>
  );
}
