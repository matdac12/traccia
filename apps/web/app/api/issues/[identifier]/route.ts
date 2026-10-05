import { getIssueDetail } from "@/lib/api/issues";
import { errorResponse } from "@/lib/api/route-error";

export const dynamic = "force-dynamic";

/** The open issue detail again (with comments, activity, ...), for the detail page's poll. */
export async function GET(_request: Request, { params }: { params: Promise<{ identifier: string }> }) {
  try {
    return Response.json(await getIssueDetail((await params).identifier));
  } catch (err) {
    return errorResponse(err);
  }
}
