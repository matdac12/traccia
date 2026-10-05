"use server";

import { createCommentInputSchema, patchIssueBodySchema, updateCommentInputSchema } from "@traccia/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createComment, deleteComment, updateComment } from "@/lib/api/comments";
import { createIssue, deleteIssue, findIssues, getIssue, getIssueDetail, patchIssue, restoreIssue } from "@/lib/api/issues";
import type { Comment, Issue, IssueRef, Reply } from "@/lib/api/schemas";
import { ApiError } from "@/lib/api/client";
import { deleteAttachment } from "@/lib/api/attachments";
import { restoreItem } from "@/lib/api/trash";
import { ATTACHMENT_ID } from "@/lib/attachments";
import { type ActionResult, toFailure } from "@/lib/issue-detail/result";

// Writes from the issue page. Each one validates its input, calls the server-only API client and
// revalidates the page, so the next render shows the new issue and its activity row.

// Identifiers (`MAT-12`) and ids (ULIDs) only: the value ends up in an API path and in revalidatePath.
const refSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "not a valid issue reference");
const titleSchema = z.string().trim().min(1, "A sub-issue needs a title").max(500);

const patchSchema = patchIssueBodySchema.omit({ expectedUpdatedAt: true }).strict();

function invalid(message: string): { ok: false; code: string; message: string } {
  return { ok: false, code: "validation_error", message };
}

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
  const ref = refSchema.safeParse(identifier);
  const parsed = patchSchema.safeParse(patch);
  if (!ref.success) return invalid(ref.error.issues[0]!.message);
  if (!parsed.success) return invalid(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
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

/** The parent's id and project come from the API, not from the browser. */
export async function createSubIssueAction(parentIdentifier: string, title: string): Promise<ActionResult<{ issue: Issue }>> {
  const ref = refSchema.safeParse(parentIdentifier);
  const t = titleSchema.safeParse(title);
  if (!ref.success) return invalid(ref.error.issues[0]!.message);
  if (!t.success) return invalid(t.error.issues[0]!.message);
  try {
    const parent = await getIssue(ref.data);
    const { issue } = await createIssue({ project: parent.key, title: t.data, parentId: parent.id }, []);
    refresh(parent.identifier);
    return { ok: true, issue };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Makes an existing issue a child of `parentIdentifier`. The parent's id comes from the API; the
 * API refuses a different project, a cycle, or an issue that is itself a sub-issue's ancestor.
 */
export async function linkSubIssueAction(parentIdentifier: string, childIdentifier: string): Promise<ActionResult<{ issue: Issue }>> {
  const parentRef = refSchema.safeParse(parentIdentifier);
  const childRef = refSchema.safeParse(childIdentifier);
  if (!parentRef.success) return invalid(parentRef.error.issues[0]!.message);
  if (!childRef.success) return invalid(childRef.error.issues[0]!.message);
  try {
    const parent = await getIssue(parentRef.data);
    const issue = await patchIssue(childRef.data, { parentId: parent.id });
    refresh(parent.identifier);
    refresh(issue.identifier);
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
  const ref = refSchema.safeParse(identifier);
  const input = createCommentInputSchema.safeParse({ body, parentId });
  if (!ref.success || !input.success) return invalid("A comment cannot be empty");
  try {
    const comment = await createComment(ref.data, input.data);
    refresh(identifier);
    return { ok: true, comment };
  } catch (err) {
    return toFailure(err);
  }
}

/** Only the comment's own actor may edit it; for someone else's comment the API answers `forbidden`. */
export async function updateCommentAction(identifier: string, commentId: string, body: string): Promise<ActionResult> {
  const ref = refSchema.safeParse(identifier);
  const id = refSchema.safeParse(commentId);
  const input = updateCommentInputSchema.safeParse({ body });
  if (!ref.success || !id.success || !input.success) return invalid("A comment cannot be empty");
  try {
    await updateComment(id.data, input.data.body);
    refresh(identifier);
    return { ok: true };
  } catch (err) {
    return toFailure(err);
  }
}

export async function deleteCommentAction(identifier: string, commentId: string): Promise<ActionResult> {
  if (!refSchema.safeParse(identifier).success || !refSchema.safeParse(commentId).success) return invalid("not a valid reference");
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
  if (!refSchema.safeParse(identifier).success) return invalid("not a valid issue reference");
  try {
    await deleteIssue(identifier);
    // No revalidation: re-rendering this page now would 404 and replace the undo notice. Other pages are dynamic.
    return { ok: true };
  } catch (err) {
    return toFailure(err);
  }
}

export async function restoreIssueAction(identifier: string): Promise<ActionResult> {
  if (!refSchema.safeParse(identifier).success) return invalid("not a valid issue reference");
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
  if (typeof query !== "string" || query.length > 200) return invalid("Search text is too long");
  try {
    return { ok: true, issues: await findIssues(query) };
  } catch (err) {
    return toFailure(err);
  }
}

// Attachments (TRC-51). Uploads go through the streaming route handler at
// `/api/issues/[identifier]/attachments`; delete and undo are plain actions.

export async function deleteAttachmentAction(identifier: string, id: string): Promise<ActionResult> {
  if (!refSchema.safeParse(identifier).success || !ATTACHMENT_ID.test(id)) return invalid("not a valid attachment");
  try {
    await deleteAttachment(id);
    refresh(identifier);
    return { ok: true };
  } catch (err) {
    return toFailure(err);
  }
}

export async function restoreAttachmentAction(identifier: string, id: string): Promise<ActionResult> {
  if (!refSchema.safeParse(identifier).success || !ATTACHMENT_ID.test(id)) return invalid("not a valid attachment");
  try {
    await restoreItem("attachment", id);
    refresh(identifier);
    return { ok: true };
  } catch (err) {
    return toFailure(err);
  }
}
