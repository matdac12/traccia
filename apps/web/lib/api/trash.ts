import "server-only";
import { api } from "./client";
import { pageOf, purgeResultSchema, restoreResultSchema, trashItemSchema, type TrashType } from "./schemas";

const PAGE_SIZE = 50;
const MAX_BATCH_PAGES = 20;

export function listTrash(opts: { type?: TrashType; cursor?: string; limit?: number } = {}) {
  return api().request("/trash", {
    schema: pageOf(trashItemSchema),
    query: { type: opts.type, cursor: opts.cursor, limit: opts.limit ?? PAGE_SIZE },
  });
}

/**
 * Every trashed item (all types), for batch grouping and the "goes with it" counts. The trash is
 * small by design (a safety net, purged by hand), so this walks the pages up to a cap.
 */
export async function listAllTrash() {
  const items = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_BATCH_PAGES; i++) {
    const page = await api().request("/trash", { schema: pageOf(trashItemSchema), query: { limit: 250, cursor } });
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

/** Restores the whole batch the item was deleted in. */
export function restoreItem(type: TrashType, id: string) {
  return api().request("/restore", { schema: restoreResultSchema, method: "POST", body: { type, id } });
}

const PURGE_PATH: Record<TrashType, string> = {
  project: "projects",
  milestone: "milestones",
  issue: "issues",
  comment: "comments",
  attachment: "attachments",
};

/** Permanently removes an item that is already in the trash (`you` actor only). */
export function purgeItem(type: TrashType, id: string) {
  return api().request(`/${PURGE_PATH[type]}/${encodeURIComponent(id)}`, {
    schema: purgeResultSchema,
    method: "DELETE",
    query: { purge: true },
  });
}
