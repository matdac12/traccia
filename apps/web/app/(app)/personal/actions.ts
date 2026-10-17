"use server";
import { createTodoInputSchema, type Todo, updateTodoInputSchema } from "@traccia/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionFailure, failure, success, toFailure, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import { ApiError } from "@/lib/api/client";
import { createTodo, deleteTodo, updateTodo } from "@/lib/api/todos";
import { REF } from "@/lib/documentation";
import type { QuickAddParse } from "@/lib/personal/quick-add";
import type { TodoPatch } from "@/lib/personal/todo-changes";

const idSchema = z.string().regex(REF);

/**
 * Quick add's write. The API checks the rest (a Reminder moment already past is a field error on `time`). The
 * revalidation re-renders `/personal` in the same round trip, so the new To-do shows without waiting for the poll.
 */
export async function createTodoAction(values: QuickAddParse): Promise<ActionResult<{ id: string }>> {
  const parsed = createTodoInputSchema.safeParse({ title: values.title, day: values.day, time: values.time ?? undefined });
  if (!parsed.success) return failure("Fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    const todo = await createTodo(parsed.data);
    revalidatePath("/personal");
    return success({ id: todo.id });
  } catch (err) {
    return toFailure(err);
  }
}

/** A refused To-do write. `openSubTodos` is set when a parent can't close alone: retry with `closeSubTodos: true`. */
export type TodoWriteFailure = ActionFailure & { openSubTodos?: number };

/**
 * A row or details edit: day, Reminder, state, title or Details. Re-renders `/personal` like quick add.
 * `expectedUpdatedAt` is the `updatedAt` the page last saw: if the To-do changed since (Parla, another tab), the API
 * refuses with a 409 and the page re-renders with the current To-do.
 */
export async function updateTodoAction(id: string, patch: TodoPatch, expectedUpdatedAt: string): Promise<ActionResult<{ todo: Todo }> | TodoWriteFailure> {
  if (!idSchema.safeParse(id).success) return failure("Not a valid To-do id.");
  const parsed = updateTodoInputSchema.safeParse({ ...patch, expectedUpdatedAt });
  if (!parsed.success) return failure("Fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    const todo = await updateTodo(id, parsed.data);
    revalidatePath("/personal");
    return success({ todo });
  } catch (err) {
    if (err instanceof ApiError && err.code === "conflict" && typeof err.details.openSubTodos === "number") {
      return { ...failure(err.message), openSubTodos: err.details.openSubTodos };
    }
    const result = toFailure(err);
    if (result.conflict) revalidatePath("/personal");
    return result;
  }
}

/** Delete goes to the Trash (restorable), so the page asks nothing first. */
export async function deleteTodoAction(id: string): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) return failure("Not a valid To-do id.");
  try {
    await deleteTodo(id);
    revalidatePath("/personal");
    return success(undefined);
  } catch (err) {
    return toFailure(err);
  }
}
