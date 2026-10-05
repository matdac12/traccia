import { z } from "zod";
import { latestIssueChange } from "@/lib/api/issues";
import { errorResponse } from "@/lib/api/route-error";

export const dynamic = "force-dynamic";

const querySchema = z.object({ since: z.iso.datetime().optional() });

/** Polling probe: `{ latest }` is the newest change after `since` (or null). See `latestIssueChange`. */
export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "since must be an ISO datetime", details: {} } }, { status: 400 });
  try {
    return Response.json({ latest: await latestIssueChange(parsed.data.since) });
  } catch (err) {
    return errorResponse(err);
  }
}
