import { ListTodo } from "lucide-react";
import Link from "next/link";
import { ActorAvatar, StatusIcon } from "@/components/traccia/atoms";
import { EmptyState } from "@/components/traccia/empty-state";
import type { Issue } from "@/lib/api/schemas";

/**
 * Minimal issue list for the project page.
 * TODO(MAT-1720): replace with the shared issues table once it lands on main.
 */
export function ProjectIssueList({ issues, hasMore }: { issues: Issue[]; hasMore: boolean }) {
  if (issues.length === 0) return <EmptyState icon={ListTodo} title="No issues in this project yet">Press C to create one.</EmptyState>;
  return (
    <>
      <ul className="divide-y">
        {issues.map((i) => (
          <li key={i.id}>
            <Link href={`/issues/${i.identifier}`} className="flex h-9 items-center gap-3 px-4 text-[13px] hover:bg-accent">
              <StatusIcon status={i.status} />
              <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">{i.identifier}</span>
              <span className="flex-1 truncate">{i.title}</span>
              <span className="hidden gap-1 sm:flex">
                {i.labels.map((l) => (
                  <span key={l.id} className="inline-flex items-center gap-1 rounded-full border px-1.5 text-[10px] text-muted-foreground">
                    <span className="size-1.5 rounded-full" style={{ background: l.color }} />{l.name}
                  </span>
                ))}
              </span>
              <ActorAvatar who={i.assignee} size={16} />
            </Link>
          </li>
        ))}
      </ul>
      {hasMore ? <p className="px-4 py-2 text-xs text-muted-foreground">Showing the {issues.length} most recently updated issues.</p> : null}
    </>
  );
}
