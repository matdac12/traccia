import type { SubTodoCount } from "@traccia/shared";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { todos } from "../db/schema.js";
import type { DbHandle } from "./context.js";

/**
 * The `n/m` count of each top-level To-do's live Sub-to-dos, in one grouped
 * query for the whole page. `total` leaves out dropped ones ("won't do");
 * `done` counts the done ones. A Sub-to-do has no count (`null`), and a parent
 * without Sub-to-dos is `0/0`.
 */
export function loadSubTodoCounts(
  db: DbHandle,
  rows: readonly { id: string; parentId: string | null }[],
): Map<string, SubTodoCount | null> {
  const counts = new Map<string, SubTodoCount | null>(
    rows.map((row) => [row.id, row.parentId === null ? zero() : null]),
  );
  const parentIds = rows.filter((r) => r.parentId === null).map((r) => r.id);
  if (parentIds.length === 0) return counts;

  const grouped = db
    .select({
      parentId: todos.parentId,
      done: sql<number>`coalesce(sum(${todos.state} = 'done'), 0)`,
      total: sql<number>`count(*)`,
    })
    .from(todos)
    .where(
      and(
        inArray(todos.parentId, parentIds),
        isNull(todos.deletedAt),
        sql`${todos.state} <> 'dropped'`,
      ),
    )
    .groupBy(todos.parentId)
    .all();
  for (const { parentId, done, total } of grouped) {
    if (parentId !== null) counts.set(parentId, { done, total });
  }
  return counts;
}

const zero = (): SubTodoCount => ({ done: 0, total: 0 });
