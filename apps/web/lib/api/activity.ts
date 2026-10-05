import "server-only";
import { api } from "./client";
import { activityFeedItemSchema, pageOf } from "./schemas";

const ACTIVITY_PAGE_SIZE = 30;

/** `GET /activity` scoped to one project (id, name or key), newest first. */
export function listProjectActivity(projectId: string, cursor?: string) {
  return api().request("/activity", { schema: pageOf(activityFeedItemSchema), query: { project: projectId, limit: ACTIVITY_PAGE_SIZE, cursor } });
}
