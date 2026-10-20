import { keyCandidatesIn, type Todo } from "@traccia/shared";

export type ProjectReference = Todo["references"][number];

export type TitleSegment = { text: string } | ProjectReference;

/**
 * A To-do title split into text and Project chips. The API decides which `@KEY`s are references; this only finds
 * them again in the text, with the same candidate rule (an `@` not preceded by a letter or digit, and the whole run
 * after it). A key the references don't name stays plain text. A key naming several Projects (keys can be shared)
 * becomes one chip for the first of them the API lists.
 */
export function titleSegments(title: string, references: Todo["references"]): TitleSegment[] {
  // A key shared by a live and a deleted Project only reaches the API's references as live.
  const byKey = new Map<string, ProjectReference>();
  for (const r of references) if (!byKey.has(r.key)) byKey.set(r.key, r);
  const out: TitleSegment[] = [];
  let last = 0;
  for (const { key, index, end } of keyCandidatesIn(title)) {
    const ref = byKey.get(key);
    if (!ref) continue;
    if (index > last) out.push({ text: title.slice(last, index) });
    out.push(ref);
    last = end;
  }
  if (last < title.length) out.push({ text: title.slice(last) });
  return out;
}
