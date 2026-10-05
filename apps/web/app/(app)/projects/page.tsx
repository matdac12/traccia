import { ISSUE_STATUSES } from "@traccia/shared";
import { FolderKanban } from "lucide-react";
import Link from "next/link";
import { PROJECT_STATUS_TONE } from "@/components/project/project-status-select";
import { EmptyState } from "@/components/traccia/empty-state";
import { StatusIcon } from "@/components/traccia/atoms";
import { PageHeader } from "@/components/traccia/page-header";
import { Progress } from "@/components/ui/progress";
import { listProjects } from "@/lib/api/projects";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const projects = await listProjects();
  return (
    <>
      <PageHeader title="Projects" />
      {projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet">Create one with the traccia CLI, REST or an agent over MCP.</EmptyState>
      ) : (
        <ul className="divide-y overflow-y-auto">
          {projects.map((p) => {
            const counts: Partial<Record<(typeof ISSUE_STATUSES)[number], number>> = p.issueCounts ?? {};
            // Same rule as milestone progress: canceled issues do not count toward the total.
            const total = ISSUE_STATUSES.reduce((n, s) => (s === "canceled" ? n : n + (counts[s] ?? 0)), 0);
            const done = counts.done ?? 0;
            return (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="flex items-center gap-4 px-4 py-3 text-[13px] hover:bg-accent">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                      {ISSUE_STATUSES.map((s) => (counts[s] ? <span key={s} className="flex items-center gap-1 tabular-nums"><StatusIcon status={s} />{counts[s]}</span> : null))}
                    </div>
                  </div>
                  <span className={`text-[11px] capitalize ${PROJECT_STATUS_TONE[p.status]}`}>{p.status}</span>
                  <div className="w-32">
                    <Progress value={total ? Math.round((done / total) * 100) : 0} aria-label={`${p.name} progress`} className="h-1" />
                    <div className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">{done}/{total} done</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
