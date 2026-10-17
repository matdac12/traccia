import type { Todo } from "./api-client";

export type ProjectReference = Todo["references"][number];

export type TitleSegment = { text: string } | ProjectReference;

/**
 * A `@KEY` candidate as the API finds it: an `@` not preceded by a letter or digit, and the whole run of letters
 * and digits after it.
 */
const KEY_CANDIDATE = /(?<![\p{L}\p{N}])@([A-Za-z0-9]+)/gu;

/**
 * A To-do title split into text and Project chips, as the Dashboard does it. The API decides which `@KEY`s are
 * references; this finds them again in the text. A key the references don't name stays plain text, and a key naming
 * several Projects is one chip, for the first of them.
 */
export function titleSegments(
  title: string,
  references: Todo["references"],
): TitleSegment[] {
  const byKey = new Map<string, ProjectReference>();
  for (const r of references) if (!byKey.has(r.key)) byKey.set(r.key, r);
  const out: TitleSegment[] = [];
  let last = 0;
  for (const m of title.matchAll(KEY_CANDIDATE)) {
    const ref = byKey.get((m[1] as string).toUpperCase());
    if (!ref) continue;
    if (m.index > last) out.push({ text: title.slice(last, m.index) });
    out.push(ref);
    last = m.index + m[0].length;
  }
  if (last < title.length) out.push({ text: title.slice(last) });
  return out;
}
