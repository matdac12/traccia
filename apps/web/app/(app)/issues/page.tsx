import { ApiError } from "@/lib/api/client";
import { listBoardColumns, listIssueGroups, listLabels } from "@/lib/api/issues";
import { listProjects } from "@/lib/api/projects";
import { parseFilters } from "@/lib/issue-filters";
import { IssuesView, type IssuesData } from "@/components/issues-table/issues-view";

export const metadata = { title: "Issues" };

async function load(filters: ReturnType<typeof parseFilters>): Promise<{ data: IssuesData } | { error: string }> {
  try {
    // Three API requests: the groups (with the sync token), the projects (with their milestones; the layout's
    // sidebar shares this fetch) and the labels.
    const [{ groups, syncToken }, projects, labels] = await Promise.all([
      filters.view === "kanban" ? listBoardColumns(filters) : listIssueGroups(filters),
      listProjects(),
      listLabels(),
    ]);
    return { data: { groups, projects, labels, milestones: projects.flatMap((p) => p.milestones), syncToken } };
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
