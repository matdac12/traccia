/** Pure helpers for the Documentation tab (limits mirror the API: apps/api/src/service/memories.ts and documents.ts). */

export const MEMORY_TITLE_MAX = 200;
export const MEMORY_BODY_MAX_BYTES = 64 * 1024;
export const MEMORY_TAGS_MAX = 20;
export const MEMORY_TAG_MAX = 50;
export const DOCUMENT_DESCRIPTION_MAX = 2000;

/** Splits comma- or newline-separated text into trimmed, non-empty, de-duplicated tags (first-seen order). */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((t) => t.trim()).filter(Boolean))];
}

/** A server-action id or project reference: ULIDs and keys only, since the value ends up in an API path. */
export const REF = /^[A-Za-z0-9_-]{1,64}$/;

/** First line of markdown with the heading/list syntax stripped, for the memory list. */
export function snippetOf(body: string, max = 180): string {
  const text = body.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~[\]-]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
