import type { Todo } from "@traccia/shared";
import { FolderOpen } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/traccia/empty-state";
import { projectTodos } from "@/lib/personal/lists";
import { ListHeading } from "./list-heading";
import { useProjectOptions } from "./projects-context";
import { TodoRow } from "./todo-row";

/**
 * By project (docs/personal-space.md §7.3): the key as a big chip with the Project's name (a link to it), then the
 * open To-dos that reference the key, by day (Anytime last), each with its day.
 */
export function ProjectList({ todos, projectKey }: { todos: Todo[]; projectKey: string }) {
  const project = useProjectOptions().find((p) => p.key === projectKey);
  const rows = projectTodos(todos, projectKey);
  return (
    <>
      <ListHeading sub="Open To-dos that reference this Project.">
        <span className="flex flex-wrap items-baseline gap-3">
          <span className="rounded-md border bg-surface px-2 font-mono text-[24px] font-medium tracking-normal">{projectKey}</span>
          {project ? (
            <Link
              href={`/projects/${project.id}`}
              className="rounded text-[20px] font-medium tracking-[-0.02em] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {project.name}
            </Link>
          ) : null}
        </span>
      </ListHeading>
      {rows.length ? (
        <ul>
          {rows.map((t) => (
            <TodoRow key={t.id} todo={t} showDay />
          ))}
        </ul>
      ) : (
        <EmptyState icon={FolderOpen} title={`No open To-dos reference ${projectKey}`} className="rounded-lg border border-dashed py-12" />
      )}
    </>
  );
}
