import type { Project } from "@/lib/api/schemas";
import { KEY_CANDIDATE_START } from "./title";

/** A Project as the Personal Space offers it (`@` autocomplete) and links it (chips). */
export type ProjectOption = Pick<Project, "id" | "key" | "name" | "status">;

/** The `@` autocomplete lists at most this many Projects. */
export const AUTOCOMPLETE_LIMIT = 7;

const KEY_QUERY = new RegExp(`${KEY_CANDIDATE_START}([A-Za-z0-9]*)$`, "u");

/**
 * The `@` run the caret is in: an `@` at the start or after a character that is not a letter or digit (the API's
 * candidate rule, so `bob@crm.com` is not one), then letters and digits up to the caret.
 */
export function keyQueryAt(value: string, caret: number): { start: number; query: string } | null {
  const m = value.slice(0, caret).match(KEY_QUERY);
  return m ? { start: m.index ?? 0, query: m[1] as string } : null;
}

/**
 * The Projects to offer for `query` (docs/personal-space.md §7.5): active and paused ones, keys starting with it
 * first, then names containing it, each group by key, up to `AUTOCOMPLETE_LIMIT`. Case-insensitive.
 */
export function matchProjects<P extends ProjectOption>(projects: readonly P[], query: string): P[] {
  const q = query.toLowerCase();
  const open = projects.filter((p) => p.status === "active" || p.status === "paused").sort((a, b) => a.key.localeCompare(b.key));
  const byKey = open.filter((p) => p.key.toLowerCase().startsWith(q));
  const byName = open.filter((p) => !byKey.includes(p) && p.name.toLowerCase().includes(q));
  return [...byKey, ...byName].slice(0, AUTOCOMPLETE_LIMIT);
}

/**
 * `value` with the `@` run at the caret, and the rest of the word under the caret, replaced by `@KEY ` (one space,
 * shared with the text after). Returns the caret after that space.
 */
export function insertProjectKey(value: string, caret: number, key: string): { value: string; caret: number } {
  const start = keyQueryAt(value, caret)?.start ?? caret;
  const before = `${value.slice(0, start)}@${key} `;
  const after = value.slice(caret).replace(/^[A-Za-z0-9]*\s*/, "");
  return { value: before + after, caret: before.length };
}
