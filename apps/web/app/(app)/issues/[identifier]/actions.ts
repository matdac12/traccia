"use server";

import { patchIssueBodySchema } from "@linear-matti/shared";
import { revalidatePath } from "next/cache";
import { createComment, deleteComment, updateComment } from "@/lib/api/comments";
import { createIssue, deleteIssue, findIssues, getIssueDetail, patchIssue, restoreIssue } from "@/lib/api/issues";
import type { Comment, Issue, IssueRef, Reply } from "@/lib/api/schemas";
import { ApiError } from "@/lib/api/client";
import { type ActionResult, toFailure } from "@/lib/issue-detail/result";

// Writes from the issue page. Each one validates its input, calls the server-only API client and
// revalidates the page, so the next render shows the new issue and its activity row.

const patchSchema = patchIssueBodySchema.omit({ expectedUpdatedAt: true }).strict();

function refresh(identifier: string) {
  revalidatePath(`/issues/${identifier}`);
  revalidatePath("/issues");
}

/**
 * Applies a partial update. `expectedUpdatedAt` (the `updatedAt` the user last saw) goes out as
 * `If-Match`; a stale value comes back as `conflict` with the current issue and nothing is saved.
 */
export async function updateIssueAction(
  identifier: string,
  patch: unknown,
  expectedUpdatedAt: string,
): Promise<ActionResult<{ issue: Issue }>> {
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, code: "validation_error", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  try {
    const issue = await patchIssue(identifier, parsed.data, expectedUpdatedAt);
    refresh(identifier);
    return { ok: true, issue };
  } catch (err) {
    if (err instanceof ApiError && err.code === "conflict") {
      const failure = toFailure(err);
      try {
        failure.current = await getIssueDetail(identifier);
      } catch {
        // The conflict message still stands; the page refresh shows the current state.
      }
      refresh(identifier);
      return failure;
    }
    return toFailure(err);
  }
}

export async function createSubIssueAction(
  parent: { id: string; identifier: string; key: string },
  title: string,
): Promise<ActionResult<{ issue: Issue }>> {
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, code: "validation_error", message: "A sub-issue needs a title" };
  try {
    const issue = await createIssue({ project: parent.key, title: trimmed, parentId: parent.id });
    refresh(parent.identifier);
    return { ok: true, issue };
  } catch (err) {
    return toFailure(err);
  }
}

export async function createCommentAction(
  identifier: string,
  body: string,
  parentId: string | null,
): Promise<ActionResult<{ comment: Comment | Reply }>> {
  if (!body.trim()) return { ok: false, code: "validation_error", message: "A comment cannot be empty" };
  try {
    const comment = await createComment(identifier, { body, parentId });
    refresh(identifier);
    return { ok: true, comment };
  } catch (err) {
    return toFailure(err);
  }
}

/** Only the comment's own actor may edit it; for someone else's comment the API answers `forbidden`. */
export async function updateCommentAction(identifier: string, commentId: string, body: string): Promise<ActionResult> {
  if (!body.trim()) return { ok: false, code: "validation_error", message: "A comment cannot be empty" };
  try {
    await updateComment(commentId, body);
    refresh(identifier);
    return { ok: true };
  } catch (err) {
    return toFailure(err);
  }
}

export async function deleteCommentAction(identifier: string, commentId: string): Promise<ActionResult> {
  try {
    await deleteComment(commentId);
    refresh(identifier);
    return { ok: true };
  } catch (err) {
    return toFailure(err);
  }
}

/** Soft delete (Trash). The page then offers an undo that calls `restoreIssueAction`. */
export async function deleteIssueAction(identifier: string): Promise<ActionResult> {
  try {
    await deleteIssue(identifier);
    // No revalidation: re-rendering this page now would 404 and replace the undo notice. Other pages are dynamic.
    return { ok: true };
  } catch (err) {
    return toFailure(err);
  }
}

export async function restoreIssueAction(identifier: string): Promise<ActionResult> {
  try {
    await restoreIssue(identifier);
    refresh(identifier);
    return { ok: true };
  } catch (err) {
    return toFailure(err);
  }
}

/** Typeahead for blockers and parents. */
export async function searchIssuesAction(query: string): Promise<ActionResult<{ issues: IssueRef[] }>> {
  try {
    return { ok: true, issues: await findIssues(query) };
  } catch (err) {
    return toFailure(err);
  }
}
