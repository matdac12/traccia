import { Plus } from "lucide-react";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DeleteProjectButton, ProjectDeletedGate } from "@/components/project/project-delete";
import { NewIssueButton } from "@/components/project/new-issue-button";
import { ProjectStatusSelect } from "@/components/project/project-status-select";
import { ProjectTabs } from "@/components/project/project-tabs";
import { ProjectTitle } from "@/components/project/project-title";
import { PageHeader } from "@/components/traccia/page-header";
import { ApiError } from "@/lib/api/client";
import { getProject } from "@/lib/api/projects";

/** Header and Overview / Activity / Issues tabs shared by the project's three sub-pages. */
export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  return (
    <ProjectDeletedGate projectId={project.id} projectKey={project.key} name={project.name}>
      <PageHeader title={<ProjectTitle projectId={project.id} name={project.name} projectKey={project.key} updatedAt={project.updatedAt} />} tabs={<ProjectTabs projectId={project.id} />}>
        <ProjectStatusSelect projectId={project.id} status={project.status} updatedAt={project.updatedAt} />
        <DeleteProjectButton projectId={project.id} />
        <NewIssueButton projectId={project.id}><Plus className="size-3.5" />New issue</NewIssueButton>
      </PageHeader>
      {children}
    </ProjectDeletedGate>
  );
}
