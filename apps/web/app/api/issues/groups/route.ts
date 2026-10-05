import { ISSUE_STATUSES } from "@linear-matti/shared";
import { z } from "zod";
import { refreshIssueGroups } from "@/lib/api/issues";
import { errorResponse } from "@/lib/api/route-error";
import { parseFilters } from "@/lib/issue-filters";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  query: z.string().max(4000),
  counts: z.string().max(200).transform((s) => {
    const out: Record<string, number> = {};
    for (const part of s.split(",")) {
      const [status, n] = part.split(":");
      if ((ISSUE_STATUSES as readonly string[]).includes(status ?? "") && Number.isInteger(Number(n))) out[status!] = Math.max(0, Number(n));
    }
    return out;
  }),
});

/** The groups on screen, re-read: `query` is the page's search string, `counts` is `status:loaded,...`. */
export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "bad query", details: {} } }, { status: 400 });
  const filters = parseFilters(new URLSearchParams(parsed.data.query));
  try {
    return Response.json(await refreshIssueGroups(filters, parsed.data.counts, filters.view === "kanban"));
  } catch (err) {
    return errorResponse(err);
  }
}
