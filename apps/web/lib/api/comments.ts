import "server-only";
import { z } from "zod";
import { api } from "./client";
import { commentSchema } from "./schemas";

export function createComment(identifier: string, body: { body: string; parentId?: string | null }) {
  return api().request(`/issues/${encodeURIComponent(identifier)}/comments`, { schema: commentSchema, method: "POST", body });
}

/** Only the comment's own actor may edit it; anyone else gets `forbidden`. */
export function updateComment(id: string, body: string) {
  return api().request(`/comments/${encodeURIComponent(id)}`, { schema: commentSchema, method: "PATCH", body: { body } });
}

export function deleteComment(id: string) {
  return api().request(`/comments/${encodeURIComponent(id)}`, { schema: z.unknown(), method: "DELETE" });
}
