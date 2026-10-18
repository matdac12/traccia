import "server-only";
import { type CreateTodoInput, type MoveTodoPositionInput, subTodosResponseSchema, type Todo, type TodoDelivery, todoDeliverySchema, type UpdateTodoInput } from "@traccia/shared";
import { z } from "zod";
import { REF } from "../documentation";
import { dayInZone } from "../personal/days";
import type { LogbookPage, PersonalSpaceData, SelectedTodo } from "../personal/lists";
import { serverEnv } from "../server-env";
import { ApiError, api } from "./client";
import { listAll } from "./list-all";
import { pageOf, todoSchema } from "./schemas";

/** Logbook page size: newest first, so the first page usually holds every To-do closed today. */
const LOGBOOK_PAGE_LIMIT = 50;

/** Every open To-do, Sub-to-dos included: by day (Anytime last), then Position. */
export const listOpenTodos = () => listAll("/todos", todoSchema, { state: "open" });

/** One Logbook page (`GET /v1/todos?state=closed`): done and dropped To-dos, most recently closed first. */
export function listLogbookPage(cursor?: string): Promise<LogbookPage> {
  return api().request("/todos", { schema: pageOf(todoSchema), query: { state: "closed", limit: LOGBOOK_PAGE_LIMIT, cursor } });
}

/**
 * The To-dos done or dropped on `day` (in `timeZone`). The Logbook is newest first, so this reads pages only until
 * one reaches an earlier day.
 */
export async function listTodosClosedOn(day: string, timeZone: string) {
  const todos = [];
  let cursor: string | undefined;
  do {
    const page = await listLogbookPage(cursor);
    const onDay = page.items.filter((t) => t.closedAt !== null && dayInZone(t.closedAt, timeZone) === day);
    todos.push(...onDay);
    if (onDay.length < page.items.length) break;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return todos;
}

/** `GET /v1/todos/:id`, a deleted To-do included. */
export const getTodo = (id: string) => api().request(`/todos/${encodeURIComponent(id)}`, { schema: todoSchema });

/** `GET /v1/todos/:id/sub-todos`: every live Sub-to-do, open or closed, by Position. */
export const listSubTodos = (id: string) => api().request(`/todos/${encodeURIComponent(id)}/sub-todos`, { schema: subTodosResponseSchema });

/**
 * `GET /v1/todos/delivery`: whether Reminders are being delivered. Undefined when the API can't say (an older API
 * without the route, or a failed read), so the banner stays away rather than the page failing.
 */
export async function getDelivery(): Promise<TodoDelivery | undefined> {
  try {
    return await api().request("/todos/delivery", { schema: todoDeliverySchema });
  } catch (err) {
    console.warn("Could not read the Reminder delivery state:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

/** A live To-do, or null when the API says it is unknown or deleted. */
async function liveTodo(id: string): Promise<Todo | null> {
  const todo = await orNotFound(getTodo(id));
  return todo && !todo.deleted ? todo : null;
}
const orNotFound = <T>(read: Promise<T>) => read.catch((err) => (err instanceof ApiError && err.code === "not_found" ? null : Promise.reject(err)));

/** The selected To-do with its Sub-to-dos and its parent: what the details panel can show, or nothing when it is gone. */
async function readSelected(id: string): Promise<Todo[]> {
  if (!REF.test(id)) return [];
  const [todo, subTodos] = await Promise.all([liveTodo(id), orNotFound(listSubTodos(id))]);
  if (!todo || !subTodos) return [];
  const parent = todo.parentId ? await liveTodo(todo.parentId) : null;
  return [...(parent ? [parent] : []), todo, ...subTodos.items];
}

/**
 * What `/personal` shows: today in the Owner timezone, every open To-do and the ones closed today, and the To-do the
 * URL selects (`todoId`), if any. The page and its poll (`GET /api/todos`) both call this, so a page left open across
 * midnight rolls over on the next refresh. Two requests, plus one per extra page; a selected To-do adds two (three for
 * a Sub-to-do, whose parent comes too). The delivery state rides along for the banner: one more request.
 */
export async function loadPersonalSpace(now = new Date(), todoId?: string | null): Promise<PersonalSpaceData> {
  const timeZone = serverEnv().ownerTimezone;
  const today = dayInZone(now, timeZone);
  const [open, closed, selected, delivery] = await Promise.all([listOpenTodos(), listTodosClosedOn(today, timeZone), todoId ? readSelected(todoId) : [], getDelivery()]);
  const base = { today, timeZone, todos: [...open, ...closed], ...(delivery ? { delivery } : {}) };
  if (!todoId) return base;
  const loaded = new Set(base.todos.map((t) => t.id));
  const read: SelectedTodo = { id: todoId, extra: selected.filter((t) => !loaded.has(t.id)) };
  return { ...base, selected: read };
}

export function createTodo(body: CreateTodoInput) {
  return api().request("/todos", { schema: todoSchema, method: "POST", body });
}

/** `PATCH /v1/todos/:id`. Closing a parent with open Sub-to-dos is a 409 with `details.openSubTodos`. */
export function updateTodo(id: string, body: UpdateTodoInput) {
  return api().request(`/todos/${encodeURIComponent(id)}`, { schema: todoSchema, method: "PATCH", body });
}

/** `PATCH /v1/todos/:id/position`: within its bucket, right above `beforeId` or right below `afterId`. */
export function moveTodo(id: string, body: MoveTodoPositionInput) {
  return api().request(`/todos/${encodeURIComponent(id)}/position`, { schema: todoSchema, method: "PATCH", body });
}

const deletedSchema = z.object({ type: z.literal("todo"), id: z.string() }).loose();

/** Soft delete: the To-do and its Sub-to-dos go to the Trash as one batch. */
export function deleteTodo(id: string) {
  return api().request(`/todos/${encodeURIComponent(id)}`, { schema: deletedSchema, method: "DELETE" });
}
