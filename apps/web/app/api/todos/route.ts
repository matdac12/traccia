import { errorResponse } from "@/lib/api/route-error";
import { loadPersonalSpace } from "@/lib/api/todos";

export const dynamic = "force-dynamic";

/** The Personal Space data again, for the page's poll (TRC-52). */
export async function GET() {
  try {
    return Response.json(await loadPersonalSpace());
  } catch (err) {
    return errorResponse(err);
  }
}
