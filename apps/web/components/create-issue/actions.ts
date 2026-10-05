"use server";
import { revalidatePath } from "next/cache";
import { failure, success, toFailure, type ActionResult } from "@/lib/action-result";
import { createIssue } from "@/lib/api/issues";
import { listLabels } from "@/lib/api/labels";
import { listMilestones } from "@/lib/api/milestones";
import type { Label, Milestone } from "@/lib/api/schemas";
import { parseCreateIssue, type CreateIssueValues } from "./form";

export type CreateIssueOptions = { labels: Label[]; milestones: Milestone[] };

/** Labels (global + the project's) and milestones the dialog offers once a project is picked. */
export async function loadCreateIssueOptions(projectId: string): Promise<ActionResult<CreateIssueOptions>> {
  try {
    const [labels, milestones] = await Promise.all([listLabels(projectId), listMilestones(projectId)]);
    return success({ labels, milestones });
  } catch (err) {
    return toFailure(err);
  }
}

export async function createIssueAction(values: CreateIssueValues): Promise<ActionResult<{ identifier: string; labelError: string | null }>> {
  const parsed = parseCreateIssue(values);
  if (!parsed.ok) return failure("Fix the highlighted fields.", parsed.fieldErrors);
  try {
    const { issue, labelError } = await createIssue(parsed.input, parsed.labels);
    revalidatePath("/", "layout");
    return success({ identifier: issue.identifier, labelError });
  } catch (err) {
    return toFailure(err);
  }
}
