"use server";
import { ISSUE_STATUSES, issuePositionBodySchema } from "@traccia/shared";
import { z } from "zod";
import { ApiError } from "@/lib/api/client";
import { listBoardPage, moveIssue } from "@/lib/api/issues";
import { parseFilters } from "@/lib/issue-filters";

const loadMoreSchema = z.object({ query: z.string().max(4000), status: z.enum(ISSUE_STATUSES), cursor: z.string().min(1) });

/** One more page of a board column; `query` is the page's search string, so filters are re-validated here. */
export async function loadMoreBoardIssues(input: z.input<typeof loadMoreSchema>) {
  const { query, status, cursor } = loadMoreSchema.parse(input);
  return listBoardPage(parseFilters(new URLSearchParams(query)), status, cursor);
}

const moveSchema = issuePositionBodySchema.extend({ identifier: z.string().min(1) });

/**
 * Persist a drop. Failures come back as a value (a thrown error would be masked in production), so the board
 * can roll back and say why, including a 409.
 */
export async function moveBoardIssue(input: z.input<typeof moveSchema>) {
  const { identifier, ...body } = moveSchema.parse(input);
  try {
    return { ok: true as const, issue: await moveIssue(identifier, body) };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false as const, code: err.code, message: err.message };
    throw err;
  }
}
