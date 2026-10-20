import { projectKeysIn, type Todo } from "@traccia/shared";
import { eq, inArray } from "drizzle-orm";
import { projects, todoReferences } from "../db/schema.js";
import type { DbHandle, Tx } from "./context.js";

export type TodoReference = Todo["references"][number];

/**
 * Rewrites a To-do's `todo_references` from its title. Call it in the same
 * transaction that writes the title, on create and on every title save.
 * A key names every live Project that has it; only when none is live does it
 * fall back to the soft-deleted ones (a greyed chip, live again on Restore).
 * Keys that name no Project are dropped without error.
 */
export function deriveReferences(tx: Tx, todoId: string, title: string): void {
  tx.delete(todoReferences).where(eq(todoReferences.todoId, todoId)).run();
  const keys = projectKeysIn(title);
  if (keys.length === 0) return;
  const matches = tx
    .select({
      id: projects.id,
      key: projects.key,
      deletedAt: projects.deletedAt,
    })
    .from(projects)
    .where(inArray(projects.key, keys))
    .all();
  const liveKeys = new Set(
    matches.filter((p) => p.deletedAt === null).map((p) => p.key),
  );
  const chosen = matches.filter(
    (p) => p.deletedAt === null || !liveKeys.has(p.key),
  );
  if (chosen.length === 0) return;
  tx.insert(todoReferences)
    .values(chosen.map((p) => ({ todoId, projectId: p.id })))
    .run();
}

/**
 * The references of many To-dos in one query, by To-do id. Each list is in
 * the order the keys appear in the title; Projects sharing a key are ordered
 * by id. `projectDeleted` is read live, so Restore needs no rewrite here.
 */
export function loadReferences(
  db: DbHandle,
  todos: readonly { id: string; title: string }[],
): Map<string, TodoReference[]> {
  const byTodo = new Map<string, TodoReference[]>(todos.map((t) => [t.id, []]));
  if (todos.length === 0) return byTodo;
  const rows = db
    .select({
      todoId: todoReferences.todoId,
      key: projects.key,
      projectId: projects.id,
      deletedAt: projects.deletedAt,
    })
    .from(todoReferences)
    .innerJoin(projects, eq(projects.id, todoReferences.projectId))
    .where(
      inArray(
        todoReferences.todoId,
        todos.map((t) => t.id),
      ),
    )
    .all();

  const titles = new Map(todos.map((t) => [t.id, t.title]));
  const rank = new Map<string, Map<string, number>>();
  const rankOf = (todoId: string, key: string) => {
    let ranks = rank.get(todoId);
    if (!ranks) {
      ranks = new Map(
        projectKeysIn(titles.get(todoId) ?? "").map((k, i) => [k, i]),
      );
      rank.set(todoId, ranks);
    }
    return ranks.get(key) ?? Number.MAX_SAFE_INTEGER;
  };
  rows.sort(
    (a, b) =>
      rankOf(a.todoId, a.key) - rankOf(b.todoId, b.key) ||
      (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0),
  );
  for (const r of rows) {
    byTodo.get(r.todoId)?.push({
      key: r.key,
      projectId: r.projectId,
      projectDeleted: r.deletedAt !== null,
    });
  }
  return byTodo;
}
