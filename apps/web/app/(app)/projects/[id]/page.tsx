import { LabelsPanel } from "@/components/project/labels-panel";
import { MilestonesPanel } from "@/components/project/milestones-panel";
import { ProgressSummary } from "@/components/project/progress-summary";
import { ProjectDescription } from "@/components/project/project-description";
import { ApiError } from "@/lib/api/client";
import { listLabels, listProjectMilestones } from "@/lib/api/issues";
import { getProject } from "@/lib/api/projects";
import { notFound } from "next/navigation";

/** Overview: description, progress and milestones; labels sit in the side rail. */
export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  const [milestones, labels] = await Promise.all([listProjectMilestones(project.id), listLabels(project.id)]);
  return (
    <div className="grid items-start gap-x-12 gap-y-8 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0 space-y-8">
        <ProjectDescription projectId={project.id} description={project.description} updatedAt={project.updatedAt} />
        <MilestonesPanel projectId={project.id} milestones={milestones} />
      </div>
      <aside aria-label="Project details" className="min-w-0 space-y-8">
        <ProgressSummary milestones={milestones} />
        <LabelsPanel projectId={project.id} labels={labels} />
      </aside>
    </div>
  );
}
