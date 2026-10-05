import { eq } from "drizzle-orm";
import { issueRelations, issues } from "../db/schema.js";
import type { DbHandle } from "./context.js";

/**
 * Shortest chain of existing blocker relations leading from `fromId` to
 * `toId` ("from blocks ... blocks to"), as issue IDs including both ends, or
 * null if `fromId` does not transitively block `toId`. Deleted issues still
 * count: restoring them must not resurrect a cycle.
 */
export function findBlockerPath(
  db: DbHandle,
  fromId: string,
  toId: string,
): string[] | null {
  const next = db
    .select({
      blockerId: issueRelations.blockerId,
      blockedId: issueRelations.blockedId,
    })
    .from(issueRelations)
    .all()
    .reduce((m, r) => {
      const list = m.get(r.blockerId);
      if (list) list.push(r.blockedId);
      else m.set(r.blockerId, [r.blockedId]);
      return m;
    }, new Map<string, string[]>());

  const parent = new Map<string, string | null>([[fromId, null]]);
  const queue = [fromId];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i] as string;
    for (const n of next.get(node) ?? []) {
      if (parent.has(n)) continue;
      parent.set(n, node);
      if (n === toId) {
        const path = [n];
        for (let p = node as string | null; p; p = parent.get(p) ?? null) {
          path.unshift(p);
        }
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

/** Identifiers for issue IDs, in order. */
export function identifiersFor(db: DbHandle, ids: string[]): string[] {
  return ids.map(
    (id) =>
      db
        .select({ identifier: issues.identifier })
        .from(issues)
        .where(eq(issues.id, id))
        .get()?.identifier ?? id,
  );
}
