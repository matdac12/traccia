import { errorResponse } from "@/lib/api/route-error";
import { loadPersonalSpace } from "@/lib/api/todos";

export const dynamic = "force-dynamic";

/** The Personal Space data again, for the page's poll (TRC-52); `?todo=<id>` adds the To-do the details panel shows. */
export async function GET(request: Request) {
  try {
    return Response.json(await loadPersonalSpace(new Date(), new URL(request.url).searchParams.get("todo")));
  } catch (err) {
    return errorResponse(err);
  }
}
