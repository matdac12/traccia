import "server-only";
import type { CreateTodoInput, UpdateTodoInput } from "@traccia/shared";
import { z } from "zod";
import { dayInZone } from "../personal/days";
import type { PersonalSpaceData } from "../personal/lists";
import { serverEnv } from "../server-env";
import { api } from "./client";
import { listAll } from "./list-all";
import { pageOf, todoSchema } from "./schemas";

/** Logbook page size: newest first, so the first page usually holds every To-do closed today. */
const CLOSED_PAGE_LIMIT = 50;

/** Every open To-do, Sub-to-dos included: by day (Anytime last), then Position. */
export const listOpenTodos = () => listAll("/todos", todoSchema, { state: "open" });

/**
 * The To-dos done or dropped on `day` (in `timeZone`). The Logbook is newest first, so this reads pages only until
 * one reaches an earlier day.
 */
export async function listTodosClosedOn(day: string, timeZone: string) {
  const todos = [];
  let cursor: string | undefined;
  do {
    const page = await api().request("/todos", { schema: pageOf(todoSchema), query: { state: "closed", limit: CLOSED_PAGE_LIMIT, cursor } });
    const onDay = page.items.filter((t) => t.closedAt !== null && dayInZone(t.closedAt, timeZone) === day);
    todos.push(...onDay);
    if (onDay.length < page.items.length) break;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return todos;
}

/**
 * What `/personal` shows: today in the Owner timezone, every open To-do and the ones closed today. The page and its
 * poll (`GET /api/todos`) both call this, so a page left open across midnight rolls over on the next refresh.
 * Two requests, plus one per extra page.
 */
export async function loadPersonalSpace(now = new Date()): Promise<PersonalSpaceData> {
  const timeZone = serverEnv().ownerTimezone;
  const today = dayInZone(now, timeZone);
  const [open, closed] = await Promise.all([listOpenTodos(), listTodosClosedOn(today, timeZone)]);
  return { today, timeZone, todos: [...open, ...closed] };
}

export function createTodo(body: CreateTodoInput) {
  return api().request("/todos", { schema: todoSchema, method: "POST", body });
}

/** `PATCH /v1/todos/:id`. Closing a parent with open Sub-to-dos is a 409 with `details.openSubTodos`. */
export function updateTodo(id: string, body: UpdateTodoInput) {
  return api().request(`/todos/${encodeURIComponent(id)}`, { schema: todoSchema, method: "PATCH", body });
}

const deletedSchema = z.object({ type: z.literal("todo"), id: z.string() }).loose();

/** Soft delete: the To-do and its Sub-to-dos go to the Trash as one batch. */
export function deleteTodo(id: string) {
  return api().request(`/todos/${encodeURIComponent(id)}`, { schema: deletedSchema, method: "DELETE" });
}
