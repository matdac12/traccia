import { Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { LabelsPanel } from "@/components/project/labels-panel";
import { MilestonesPanel } from "@/components/project/milestones-panel";
import { ProjectDescription } from "@/components/project/project-description";
import { IssuesView, type IssuesData } from "@/components/issues-table/issues-view";
import { DeleteProjectButton, ProjectDeletedGate } from "@/components/project/project-delete";
import { ProjectTitle } from "@/components/project/project-title";
import { ProjectStatusSelect } from "@/components/project/project-status-select";
import { NewIssueButton } from "@/components/project/new-issue-button";
import { PageHeader } from "@/components/traccia/page-header";
import { ApiError } from "@/lib/api/client";
import { listIssueGroups, listLabels, listProjectMilestones } from "@/lib/api/issues";
import { getProject, listProjects } from "@/lib/api/projects";
import { parseFilters } from "@/lib/issue-filters";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const project = await getProject(id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  // The issue list is scoped to this project whatever `?project=` says.
  const filters = { ...parseFilters(query), project: project.id };
  const [milestones, labels, { groups, syncToken }, projects] = await Promise.all([listProjectMilestones(project.id), listLabels(project.id), listIssueGroups(filters), listProjects()]);
  const issues: IssuesData = { groups, projects: projects.some((p) => p.id === project.id) ? projects : [project, ...projects], labels, milestones, syncToken };
  return (
    <ProjectDeletedGate projectId={project.id} projectKey={project.key} name={project.name}>
      <PageHeader title={<ProjectTitle projectId={project.id} name={project.name} projectKey={project.key} updatedAt={project.updatedAt} />}>
        <ProjectStatusSelect projectId={project.id} status={project.status} updatedAt={project.updatedAt} />
        <DeleteProjectButton projectId={project.id} />
        <NewIssueButton projectId={project.id}><Plus className="size-3.5" />New issue</NewIssueButton>
      </PageHeader>
      <div className="grid gap-8 px-4 py-6 lg:grid-cols-[1fr_340px]">
        <ProjectDescription projectId={project.id} description={project.description} updatedAt={project.updatedAt} />
        <div className="space-y-6">
          <MilestonesPanel projectId={project.id} milestones={milestones} />
          <LabelsPanel projectId={project.id} labels={labels} />
        </div>
      </div>
      <div className="h-[560px] shrink-0 border-t">
        <IssuesView filters={filters} data={issues} lockProject title="Issues" />
      </div>
    </ProjectDeletedGate>
  );
}
