import { notFound } from "next/navigation";
import { IssueDetail } from "@/components/issue-detail/issue-detail";
import { ApiError } from "@/lib/api/client";
import { getIssue, getIssueDetail, listLabelOptions, listMilestoneOptions } from "@/lib/api/issues";
import { listProjects } from "@/lib/api/projects";

export async function generateMetadata({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  return { title: identifier.toUpperCase() };
}

export default async function IssuePage({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  const issue = await getIssueDetail(identifier).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  // Pickers are secondary: the page still works when one of them fails.
  const [projects, labels, milestones, parent] = await Promise.all([
    listProjects().catch(() => []),
    listLabelOptions(issue.key).catch(() => []),
    listMilestoneOptions(issue.key).catch(() => []),
    issue.parentId ? getIssue(issue.parentId).catch(() => null) : null,
  ]);
  return (
    <IssueDetail
      issue={issue}
      projects={projects.map(({ id, key, name }) => ({ id, key, name }))}
      labels={labels}
      milestones={milestones}
      parent={parent && { id: parent.id, identifier: parent.identifier, title: parent.title, status: parent.status }}
    />
  );
}
