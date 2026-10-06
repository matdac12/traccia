import { ProjectActivity } from "@/components/project/project-activity";
import { listProjectActivity } from "@/lib/api/activity";
import { getProjectOr404, listProjects } from "@/lib/api/projects";

export const metadata = { title: "Project activity" };

/** Activity tab: the API's activity feed filtered to this project (`GET /v1/activity?project=`). */
export default async function ProjectActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Every read accepts the route's project reference (id, name or key), so none waits on getProject:
  // they all start together. allSettled keeps the project's failure authoritative (not-found first) and
  // leaves no sibling rejection unhandled. The project list already carries this project's milestones
  // (it is the sidebar's `listProjects()`, shared through React cache), so no separate milestones call.
  const [project, page, projects] = await Promise.allSettled([getProjectOr404(id), listProjectActivity(id), listProjects()]);
  if (project.status === "rejected") throw project.reason;
  if (page.status === "rejected") throw page.reason;
  if (projects.status === "rejected") throw projects.reason;
  const milestones = projects.value.find((p) => p.id === project.value.id)?.milestones ?? [];
  return (
    <ProjectActivity
      projectId={project.value.id}
      initial={page.value.items}
      nextCursor={page.value.nextCursor}
      milestoneNames={Object.fromEntries(milestones.map((m) => [m.id, m.name]))}
      projectNames={Object.fromEntries(projects.value.map((p) => [p.id, p.name]))}
    />
  );
}
