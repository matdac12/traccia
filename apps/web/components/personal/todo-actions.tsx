"use client";
import type { Todo } from "@traccia/shared";
import { AlertDialog } from "radix-ui";
import { createContext, type ReactNode, startTransition, useContext, useOptimistic, useState } from "react";
import { deleteTodoAction, moveTodoAction, type TodoWriteFailure, updateTodoAction } from "@/app/(app)/personal/actions";
import { Button } from "@/components/ui/button";
import { firstError } from "@/lib/action-message";
import type { ActionResult } from "@/lib/action-result";
import { ownerNow } from "@/lib/personal/days";
import { hasPendingReminder } from "@/lib/personal/lists";
import { applyTodoChange, isClosing, type TodoChange, type TodoMove, type TodoPatch } from "@/lib/personal/todo-changes";
import { plural } from "@/lib/utils";

/** The writes a To-do row (and the details panel) can make, plus what they need to know. */
export type TodoActions = {
  /** Today in the Owner timezone, and the zone itself (the Reminder picker's "now"). */
  today: string;
  timeZone: string;
  /** Edits a To-do. Resolves once the API answered (or a confirm dialog opened). */
  update: (todo: Todo, patch: TodoPatch) => Promise<void>;
  /** Reorders a To-do within its bucket (a drag). Resolves once the API answered. */
  move: (todo: Todo, move: TodoMove) => Promise<void>;
  /** Deletes a To-do (and its Sub-to-dos): it goes to the Trash. */
  deleteTodo: (todo: Todo) => void;
  /** The last refused write on this To-do, shown under its row. */
  errorFor: (id: string) => string | undefined;
  dismissError: (id: string) => void;
};

const TodoActionsContext = createContext<TodoActions | null>(null);
export const TodoActionsProvider = TodoActionsContext;

export function useTodoActions(): TodoActions {
  const actions = useContext(TodoActionsContext);
  if (!actions) throw new Error("useTodoActions needs a TodoActionsProvider");
  return actions;
}

/** A write waiting for a yes: the patch to send then, and what to ask. */
type Confirm = { todo: Todo; patch: TodoPatch } & ({ kind: "close"; state: "done" | "dropped"; count: number } | { kind: "anytime" });

/** Told about each write the API took: the To-do as it saved it, or the id it deleted (with its Sub-to-dos). */
export type WriteListener = { saved?: (todo: Todo) => void; deleted?: (id: string) => void };

type WriteResult = ActionResult<{ todo: Todo }> | TodoWriteFailure;

/**
 * The Personal Space's writes (docs/personal-space.md §7.5): edits, position moves (drag) and deletes. Each one shows
 * at once (an optimistic copy of the API's rules) and goes back, with an error under the row, if the API refuses it.
 * Two edits ask first: moving a To-do with a Reminder to Anytime, and closing a parent the API says still has open
 * Sub-to-dos (its 409 `openSubTodos`), which is retried with `closeSubTodos: true` once confirmed.
 */
export function useTodoWrites(todos: Todo[], today: string, timeZone: string, listener: WriteListener = {}) {
  const [shown, addChange] = useOptimistic(todos, applyTodoChange);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const setError = (id: string, message: string | null) =>
    setErrors((current) => {
      if (!message && !(id in current)) return current;
      const { [id]: _, ...rest } = current;
      return message ? { ...rest, [id]: message } : rest;
    });

  /** Shows `change` (if any) until `send` answers; a refusal goes to `refused`. */
  const run = (todo: Todo, change: TodoChange | null, send: () => Promise<WriteResult>, refused: (result: TodoWriteFailure) => void) =>
    new Promise<void>((resolve) => {
      startTransition(async () => {
        setError(todo.id, null);
        if (change) addChange(change);
        const result = await send();
        // Inside the transition, so the error (or the confirm) shows together with the rollback.
        startTransition(() => {
          if (result.ok) listener.saved?.(result.data.todo);
          else refused(result);
        });
        resolve();
      });
    });

  const write = (todo: Todo, patch: TodoPatch, optimistic: boolean) =>
    run(
      todo,
      optimistic ? { type: "update", id: todo.id, patch, at: new Date().toISOString(), now: ownerNow(timeZone) } : null,
      () => updateTodoAction(todo.id, patch, todo.updatedAt),
      (result) => {
        if (result.openSubTodos && isClosing(patch)) {
          setConfirm({ kind: "close", todo, patch: { state: patch.state, closeSubTodos: true }, state: patch.state, count: result.openSubTodos });
        } else {
          setError(todo.id, firstError(result));
        }
      },
    );

  const actions: TodoActions = {
    today,
    timeZone,
    update(todo, patch) {
      if (patch.day === null && hasPendingReminder(todo) && patch.time === undefined) {
        setConfirm({ kind: "anytime", todo, patch });
        return Promise.resolve();
      }
      // A parent known to have open Sub-to-dos stays as it is until the API answers: its 409 opens the confirm.
      const openSubTodos = todo.subTodos ? todo.subTodos.total - todo.subTodos.done : 0;
      return write(todo, patch, !(isClosing(patch) && !patch.closeSubTodos && openSubTodos > 0));
    },
    move(todo, move) {
      return run(
        todo,
        { type: "move", id: todo.id, ...move },
        () => moveTodoAction(todo.id, move),
        (result) => setError(todo.id, `Couldn't reorder it. ${firstError(result)}`),
      );
    },
    deleteTodo(todo) {
      startTransition(async () => {
        setError(todo.id, null);
        addChange({ type: "delete", id: todo.id });
        const result = await deleteTodoAction(todo.id);
        startTransition(() => {
          if (result.ok) listener.deleted?.(todo.id);
          else setError(todo.id, result.error);
        });
      });
    },
    errorFor: (id) => errors[id],
    dismissError: (id) => setError(id, null),
  };

  const accept = () => {
    if (!confirm) return;
    setConfirm(null);
    void write(confirm.todo, confirm.patch, true);
  };

  const dialog = <ConfirmDialog confirm={confirm} onAccept={accept} onCancel={() => setConfirm(null)} />;
  return { todos: shown, actions, dialog };
}

function confirmText(confirm: Confirm): { title: string; body: ReactNode; action: string } {
  const name = <span className="font-medium text-foreground">“{confirm.todo.title}”</span>;
  if (confirm.kind === "anytime") {
    return {
      title: "Move to Anytime?",
      body: <>{name} loses its {confirm.todo.reminder?.time} Reminder: an Anytime To-do has no Reminder.</>,
      action: "Move and remove Reminder",
    };
  }
  const subTodos = plural(confirm.count, "open Sub-to-do", "open Sub-to-dos");
  const done = confirm.state === "done";
  return {
    title: done ? `Mark ${subTodos} done too?` : `Drop ${subTodos} too?`,
    body: <>{name} has {subTodos}. A parent never closes on its own.</>,
    action: done ? "Mark all done" : "Drop all",
  };
}

function ConfirmDialog({ confirm, onAccept, onCancel }: { confirm: Confirm | null; onAccept: () => void; onCancel: () => void }) {
  // Kept while the dialog animates out.
  const [last, setLast] = useState(confirm);
  if (confirm && confirm !== last) setLast(confirm);
  const text = last ? confirmText(last) : null;
  return (
    <AlertDialog.Root open={confirm !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AlertDialog.Content
          // The picker or menu it came from has closed: focus goes back to the To-do's row (its check).
          onCloseAutoFocus={(e) => {
            const check = last && document.querySelector<HTMLElement>(`[data-todo-id="${last.todo.id}"] [data-todo-check]`);
            if (!check) return;
            e.preventDefault();
            check.focus();
          }}
          className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-3 rounded-lg border bg-background p-5 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <AlertDialog.Title className="text-sm font-semibold">{text?.title}</AlertDialog.Title>
          <AlertDialog.Description className="text-[13px] text-muted-foreground">{text?.body}</AlertDialog.Description>
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button size="sm" onClick={onAccept}>
                {text?.action}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
