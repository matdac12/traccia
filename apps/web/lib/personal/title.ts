import type { Todo } from "@traccia/shared";

export type TitleSegment = { text: string } | { key: string; projectDeleted: boolean };

/**
 * A To-do title split into text and Project chips. The API decides which `@KEY`s are references; this only finds
 * them again in the text, with the same candidate rule (an `@` not preceded by a letter or digit, and the whole run
 * after it). A key the references don't name stays plain text.
 */
export function titleSegments(title: string, references: Todo["references"]): TitleSegment[] {
  // A key shared by a live and a deleted Project only reaches the API's references once, as live.
  const deletedByKey = new Map(references.map((r) => [r.key, r.projectDeleted]));
  const out: TitleSegment[] = [];
  let last = 0;
  for (const m of title.matchAll(/(?<![\p{L}\p{N}])@([A-Za-z0-9]+)/gu)) {
    const key = (m[1] as string).toUpperCase();
    const projectDeleted = deletedByKey.get(key);
    if (projectDeleted === undefined) continue;
    if (m.index > last) out.push({ text: title.slice(last, m.index) });
    out.push({ key, projectDeleted });
    last = m.index + m[0].length;
  }
  if (last < title.length) out.push({ text: title.slice(last) });
  return out;
}
