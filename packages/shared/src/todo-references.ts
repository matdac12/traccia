// Which `@KEY` runs in a To-do title name a Project (docs/personal-space.md §2.6). The API derives a To-do's
// references from them on every title save; the Dashboard applies the same rule to show an edited title's chips before
// the API answers.

import { KEY_CANDIDATE_START } from "./project-autocomplete.js";
import { issueKeySchema } from "./schemas.js";
import type { Todo } from "./todo-schemas.js";

type TodoReference = Todo["references"][number];

/** A project option as far as references need it. */
type KeyedProject = { id: string; key: string };

const KEY_CANDIDATE = new RegExp(`${KEY_CANDIDATE_START}([A-Za-z0-9]+)`, "gu");

/**
 * The `@KEY` candidates of a title, in order of appearance: an `@` at the start or right after a character that is not
 * a letter or digit (`bob@crm.com` is an email address, `(@crm)` and `x,@crm` are references), then the whole run of
 * letters and digits. `key` is the run uppercased; `index` and `end` bound the `@` and the run in the title.
 */
export function keyCandidatesIn(title: string): { key: string; index: number; end: number }[] {
  return [...title.matchAll(KEY_CANDIDATE)].map((m) => ({ key: (m[1] as string).toUpperCase(), index: m.index, end: m.index + m[0].length }));
}

/**
 * The Project keys a title names, uppercased, in order of appearance and without duplicates. The whole run has to be
 * a valid Project key (`issueKeySchema`), so `@ABCDEFGHI` (9) or `@1AB` is plain text rather than a truncated match.
 */
export function projectKeysIn(title: string): string[] {
  const keys = new Set<string>();
  for (const { key } of keyCandidatesIn(title)) if (issueKeySchema.safeParse(key).success) keys.add(key);
  return [...keys];
}

/**
 * The references the API will derive from `title` once it saves it, as far as a page can tell: every `@KEY` that names
 * one of the `projects` (all live), then the ones of `kept` the title still names that no live Project has (a deleted
 * Project's key stays a reference, greyed).
 */
export function referencesIn(title: string, projects: readonly KeyedProject[], kept: readonly TodoReference[] = []): TodoReference[] {
  const keys = new Set(projectKeysIn(title));
  const live = projects.filter((p) => keys.has(p.key.toUpperCase())).map((p) => ({ key: p.key, projectId: p.id, projectDeleted: false }));
  return [...live, ...kept.filter((r) => keys.has(r.key) && !live.some((l) => l.key === r.key))];
}
