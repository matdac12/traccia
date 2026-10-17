"use server";
import { createTodoInputSchema } from "@traccia/shared";
import { revalidatePath } from "next/cache";
import { failure, success, toFailure, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import { createTodo } from "@/lib/api/todos";
import type { QuickAddParse } from "@/lib/personal/quick-add";

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
