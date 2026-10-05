import { ProjectActivity } from "@/components/project/project-activity";
import { listProjectActivity } from "@/lib/api/activity";
import { listProjectMilestones } from "@/lib/api/issues";
import { getProjectOr404, listProjects } from "@/lib/api/projects";

export const metadata = { title: "Project activity" };

/** Activity tab: the API's activity feed filtered to this project (`GET /v1/activity?project=`). */
export default async function ProjectActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectOr404(id);
  const [page, milestones, projects] = await Promise.all([listProjectActivity(project.id), listProjectMilestones(project.id), listProjects()]);
  return (
    <ProjectActivity
      projectId={project.id}
      initial={page.items}
      nextCursor={page.nextCursor}
      milestoneNames={Object.fromEntries(milestones.map((m) => [m.id, m.name]))}
      projectNames={Object.fromEntries(projects.map((p) => [p.id, p.name]))}
    />
  );
}
