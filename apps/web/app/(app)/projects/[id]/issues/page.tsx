import { notFound } from "next/navigation";
import { IssuesView, type IssuesData } from "@/components/issues-table/issues-view";
import { ApiError } from "@/lib/api/client";
import { listBoardColumns, listIssueGroups, listLabels, listProjectMilestones } from "@/lib/api/issues";
import { getProject, listProjects } from "@/lib/api/projects";
import { parseFilters } from "@/lib/issue-filters";

export const metadata = { title: "Project issues" };

/** Issues tab: the shared issue table and board (filters live in this page's URL), locked to the project. */
export default async function ProjectIssuesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const project = await getProject(id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  // The list is scoped to this project whatever `?project=` says.
  const filters = { ...parseFilters(query), project: project.id };
  let data: IssuesData | undefined;
  let error: string | undefined;
  try {
    const [milestones, labels, { groups, syncToken }, projects] = await Promise.all([
      listProjectMilestones(project.id),
      listLabels(project.id),
      filters.view === "kanban" ? listBoardColumns(filters) : listIssueGroups(filters),
      listProjects(),
    ]);
    data = { groups, projects: projects.some((p) => p.id === project.id) ? projects : [project, ...projects], labels, milestones, syncToken };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    error = err.code === "validation_error" ? `The API rejected these filters: ${err.message}` : err.message;
  }
  return (
    <div className="min-h-[28rem] flex-1">
      <IssuesView filters={filters} {...(data ? { data } : { error })} lockProject title="Issues" />
    </div>
  );
}
