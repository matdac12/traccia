import "server-only";
import type { RestoreResult, TrashType } from "@/lib/api/schemas";
import { restoreItem } from "@/lib/api/trash";

export type RestoreAttempt = { ok: true; result: RestoreResult } | { ok: false; error: unknown };

/**
 * Brings `id` (and the batch it was deleted with) back from the Trash, then calls `revalidate` to re-render what shows
 * it. The Trash page and the Personal Space's undo both restore this way; each words a refusal in its own way, so the
 * API's error is handed back as it came.
 */
export async function restoreFromTrash(type: TrashType, id: string, revalidate: () => void): Promise<RestoreAttempt> {
  try {
    const result = await restoreItem(type, id);
    revalidate();
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error };
  }
}
