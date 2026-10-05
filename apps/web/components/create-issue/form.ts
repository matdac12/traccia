import { createIssueInputSchema, type Actor, type IssueStatus, type Priority } from "@traccia/shared";
import { zodFieldErrors } from "@/lib/action-result";

/** What the create-issue form collects (also what the server action receives). */
export type CreateIssueValues = {
  title: string;
  description: string;
  /** Project id. */
  project: string;
  status: IssueStatus;
  priority: Priority;
  assignee: Actor | null;
  milestoneId: string | null;
  /** Label names; they must already exist. */
  labels: string[];
};

export type ParsedCreateIssue =
  | { ok: true; input: ReturnType<typeof createIssueInputSchema.parse>; labels: string[] }
  | { ok: false; fieldErrors: Record<string, string> };

/** Validates the form with the same schema the API uses, so errors match before and after the round trip. */
export function parseCreateIssue(values: CreateIssueValues): ParsedCreateIssue {
  const parsed = createIssueInputSchema.safeParse({
    project: values.project,
    title: values.title,
    description: values.description || undefined,
    status: values.status,
    priority: values.priority,
    assignee: values.assignee,
    milestoneId: values.milestoneId,
  });
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };
  return { ok: true, input: parsed.data, labels: values.labels };
}
