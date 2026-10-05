import type { Comment, Reply } from "@/lib/api/schemas";

const byTime = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt);

/**
 * Arranges comments into threads: top-level comments oldest first, each with its replies oldest
 * first, one level deep. The API already nests replies, but this also accepts a flat list (a
 * reply whose parent is missing is shown as a top-level comment instead of vanishing) and
 * flattens anything deeper into the thread of its top-level ancestor.
 */
export function buildThreads(input: readonly (Reply & { replies?: readonly Reply[] })[]): Comment[] {
  const all = new Map<string, Reply>();
  const visit = (c: Reply & { replies?: readonly Reply[] }) => {
    const { replies, ...rest } = c;
    all.set(rest.id, rest);
    for (const r of replies ?? []) visit(r);
  };
  input.forEach(visit);

  const rootOf = (c: Reply): string | null => {
    let cur = c;
    const seen = new Set<string>();
    while (cur.parentId) {
      const parent = all.get(cur.parentId);
      if (!parent || seen.has(cur.id)) return null;
      seen.add(cur.id);
      cur = parent;
    }
    return cur.id;
  };

  const roots = new Map<string, Comment>();
  const replies: Reply[] = [];
  for (const c of all.values()) {
    const root = rootOf(c);
    if (root === c.id || root === null) roots.set(c.id, { ...c, parentId: root === null ? null : c.parentId, replies: [] });
    else replies.push(c);
  }
  for (const r of replies.sort(byTime)) {
    const root = rootOf(r);
    if (root) roots.get(root)?.replies.push(r);
  }
  return [...roots.values()].sort(byTime);
}
