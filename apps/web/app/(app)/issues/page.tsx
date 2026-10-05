import { ApiError } from "@/lib/api/client";
import { listBoardColumns, listIssueGroups, listLabels, listProjectMilestones } from "@/lib/api/issues";
import { listProjects } from "@/lib/api/projects";
import { parseFilters } from "@/lib/issue-filters";
import { IssuesView, type IssuesData } from "@/components/issues-table/issues-view";

export const metadata = { title: "Issues" };

async function load(filters: ReturnType<typeof parseFilters>): Promise<{ data: IssuesData } | { error: string }> {
  try {
    const projects = await listProjects();
    const [groups, labels, milestones] = await Promise.all([
      (filters.view === "kanban" ? listBoardColumns(filters) : listIssueGroups(filters)),
      listLabels(),
      Promise.all(projects.map((p) => listProjectMilestones(p.id))).then((m) => m.flat()),
    ]);
    return { data: { groups, projects, labels, milestones } };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.code === "validation_error" ? `The API rejected these filters: ${err.message}` : err.message };
    throw err;
  }
}

export default async function IssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseFilters(await searchParams);
  const result = await load(filters);
  return <IssuesView filters={filters} {...("data" in result ? { data: result.data } : { error: result.error })} />;
}
