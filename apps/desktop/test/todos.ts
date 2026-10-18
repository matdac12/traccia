import type { Todo } from "../src/api-client";

let next = 0;

/** An open Anytime To-do as the API returns it, with `overrides`. */
export function todo(overrides: Partial<Todo> = {}): Todo {
  next += 1;
  const id = overrides.id ?? `td_${next}`;
  return {
    id,
    title: `To-do ${next}`,
    references: [],
    day: null,
    reminder: null,
    state: "open",
    closedAt: null,
    parentId: null,
    subTodos: null,
    position: next,
    details: null,
    source: "desktop",
    url: `https://box.tail.ts.net/personal?todo=${id}`,
    createdAt: "2026-10-17T10:00:00.000Z",
    updatedAt: "2026-10-17T10:00:00.000Z",
    ...overrides,
  };
}
