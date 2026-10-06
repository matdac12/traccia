import { IssuesView, type IssuesData } from "@/components/issues-table/issues-view";
import { ApiError } from "@/lib/api/client";
import { listBoardColumns, listIssueGroups, listLabels } from "@/lib/api/issues";
import { getProjectOr404, listProjects } from "@/lib/api/projects";
import { parseFilters } from "@/lib/issue-filters";

export const metadata = { title: "Project issues" };

/** Issues tab: the shared issue table and board (filters live in this page's URL), locked to the project. */
export default async function ProjectIssuesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const parsed = parseFilters(query);
  // The reads accept the route's project reference (id, name or key), so they start together instead of
  // waiting on getProject. allSettled keeps the project's failure authoritative (not-found first) and
  // leaves no sibling rejection unhandled.
  const fetchFilters = { ...parsed, project: id };
  const [projectR, labelsR, groupsR, projectsR] = await Promise.allSettled([
    getProjectOr404(id),
    listLabels(id),
    fetchFilters.view === "kanban" ? listBoardColumns(fetchFilters) : listIssueGroups(fetchFilters),
    listProjects(),
  ]);
  if (projectR.status === "rejected") throw projectR.reason;
  const project = projectR.value;
  // The list is scoped to this project whatever `?project=` says.
  const filters = { ...parsed, project: project.id };
  let data: IssuesData | undefined;
  let error: string | undefined;
  try {
    if (labelsR.status === "rejected") throw labelsR.reason;
    if (groupsR.status === "rejected") throw groupsR.reason;
    if (projectsR.status === "rejected") throw projectsR.reason;
    const { groups, syncToken } = groupsR.value;
    const projects = projectsR.value;
    // listProjects() already embeds this project's milestones (shared with the sidebar), so none is fetched again.
    const milestones = projects.find((p) => p.id === project.id)?.milestones ?? [];
    data = { groups, projects: projects.some((p) => p.id === project.id) ? projects : [project, ...projects], labels: labelsR.value, milestones, syncToken };
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
