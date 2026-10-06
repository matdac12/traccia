import { z } from "zod";
import { listProjectActivity } from "@/lib/api/activity";
import { errorResponse } from "@/lib/api/route-error";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  project: z.string().min(1),
  cursor: z.string().min(1),
});

/** One more page of a project's activity feed, for the Activity tab's "Load more". */
export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: { code: "validation_error", message: "project and cursor are required", details: {} } }, { status: 400 });
  }
  try {
    return Response.json(await listProjectActivity(parsed.data.project, parsed.data.cursor));
  } catch (err) {
    return errorResponse(err);
  }
}
