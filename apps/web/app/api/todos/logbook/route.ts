import { jsonWithEtag } from "@/lib/api/json-etag";
import { errorResponse } from "@/lib/api/route-error";
import { listLogbookPage } from "@/lib/api/todos";

export const dynamic = "force-dynamic";

/** One Logbook page for the Personal Space, newest first; `?cursor=` (the previous `nextCursor`) reads the next one. */
export async function GET(request: Request) {
  try {
    return jsonWithEtag(request, await listLogbookPage(new URL(request.url).searchParams.get("cursor") || undefined));
  } catch (err) {
    return errorResponse(err);
  }
}
