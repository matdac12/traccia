import type { IssueStatus } from "@traccia/shared";
import type { IssueRow } from "@/lib/api/schemas";

type Group = { status: IssueStatus; items: IssueRow[] };

/**
 * Puts `row` into the groups (table groups or board columns): replaced in place, or, when its status changed,
 * moved to the top of its new group. Every other field of the groups is kept. Unknown rows are left out.
 */
export function upsertRow<G extends Group>(groups: G[], row: IssueRow): G[] {
  const from = groups.find((g) => g.items.some((i) => i.id === row.id));
  if (!from) return groups;
  if (from.status === row.status) return groups.map((g) => (g === from ? { ...g, items: g.items.map((i) => (i.id === row.id ? row : i)) } : g));
  return groups.map((g) => {
    if (g === from) return { ...g, items: g.items.filter((i) => i.id !== row.id) };
    return g.status === row.status ? { ...g, items: [row, ...g.items] } : g;
  });
}
