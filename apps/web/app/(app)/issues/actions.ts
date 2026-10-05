"use server";
import { ISSUE_STATUSES } from "@traccia/shared";
import { z } from "zod";
import { listIssuePage } from "@/lib/api/issues";
import { parseFilters } from "@/lib/issue-filters";

const loadMoreSchema = z.object({
  query: z.string().max(4000),
  status: z.enum(ISSUE_STATUSES),
  cursor: z.string().min(1),
});

/** One more page of a status group; `query` is the page's search string, so filters are re-validated here. */
export async function loadMoreIssues(input: z.input<typeof loadMoreSchema>) {
  const { query, status, cursor } = loadMoreSchema.parse(input);
  return listIssuePage(parseFilters(new URLSearchParams(query)), status, cursor);
}
