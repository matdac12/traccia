import { Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { LabelsPanel } from "@/components/project/labels-panel";
import { MilestonesPanel } from "@/components/project/milestones-panel";
import { ProjectDescription } from "@/components/project/project-description";
import { ProjectIssueList } from "@/components/project/project-issue-list";
import { ProjectStatusSelect } from "@/components/project/project-status-select";
import { NewIssueButton } from "@/components/project/new-issue-button";
import { PageHeader } from "@/components/traccia/page-header";
import { ApiError } from "@/lib/api/client";
import { listProjectIssues } from "@/lib/api/issues";
import { listLabels } from "@/lib/api/labels";
import { listMilestones } from "@/lib/api/milestones";
import { getProject } from "@/lib/api/projects";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  const [milestones, labels, issues] = await Promise.all([listMilestones(project.id), listLabels(project.id), listProjectIssues(project.id)]);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PageHeader title={project.name}>
        <ProjectStatusSelect projectId={project.id} status={project.status} />
        <NewIssueButton projectId={project.id}><Plus className="size-3.5" />New issue</NewIssueButton>
      </PageHeader>
      <div className="grid gap-8 px-4 py-6 lg:grid-cols-[1fr_340px]">
        <ProjectDescription projectId={project.id} description={project.description} />
        <div className="space-y-6">
          <MilestonesPanel projectId={project.id} milestones={milestones} />
          <LabelsPanel projectId={project.id} labels={labels} />
        </div>
      </div>
      <div className="border-t">
        <h2 className="px-4 pb-1 pt-3 text-[13px] font-medium">Issues</h2>
        <ProjectIssueList issues={issues.items} hasMore={issues.nextCursor !== null} />
      </div>
    </div>
  );
}
