import { FolderKanban } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/traccia/empty-state";
import { PageHeader } from "@/components/traccia/page-header";
import { listProjects } from "@/lib/api/projects";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const projects = await listProjects();
  return (
    <>
      <PageHeader title="Projects" />
      {projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet">Create one with the tracker CLI, REST or an agent over MCP.</EmptyState>
      ) : (
        <ul className="divide-y overflow-y-auto">
          {projects.map((p) => {
            const open = Object.entries(p.issueCounts ?? {}).reduce((n, [s, c]) => (s === "done" || s === "canceled" ? n : n + c), 0);
            return (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="flex h-10 items-center gap-3 px-4 text-[13px] hover:bg-accent">
                  <span className="font-mono text-[11px] text-muted-foreground">{p.key}</span>
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="text-[11px] capitalize text-muted-foreground">{p.status}</span>
                  <span className="w-16 text-right text-[11px] tabular-nums text-muted-foreground">{open} open</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
