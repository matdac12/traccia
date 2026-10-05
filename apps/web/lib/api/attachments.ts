import "server-only";
import { z } from "zod";
import { api } from "./client";

/** Soft delete (to Trash). Restore goes through `restoreItem("attachment", id)` in `trash.ts`. */
export function deleteAttachment(id: string) {
  return api().request(`/attachments/${encodeURIComponent(id)}`, { schema: z.unknown(), method: "DELETE" });
}
