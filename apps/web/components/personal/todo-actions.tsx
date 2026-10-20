"use client";
import type { ProjectOption, Todo } from "@traccia/shared";
import { createContext, type ReactNode, startTransition, useContext, useEffect, useInsertionEffect, useLayoutEffect, useMemo, useOptimistic, useRef, useState } from "react";
import { deleteTodoAction, moveTodoAction, restoreTodoAction, type TodoWriteFailure, updateTodoAction } from "@/app/(app)/personal/actions";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { UndoNotice } from "@/components/traccia/undo-notice";
import { Button } from "@/components/ui/button";
import { firstError } from "@/lib/action-message";
import type { ActionResult } from "@/lib/action-result";
import { latestInstantOn, ownerNow } from "@/lib/personal/days";
import { hasPendingReminder } from "@/lib/personal/lists";
import { applyTodoChange, isClosing, type TodoChange, type TodoMove, type TodoPatch } from "@/lib/personal/todo-changes";
import { plural } from "@/lib/utils";
import { createTodoStatusStore } from "./todo-status";

/**
 * The writes a To-do row (and the details panel) can make, plus what they need to know. The object only changes with
 * the day or the zone, so the rows' memoised bodies don't render again for every write in flight; what changes more
 * often (a strike drawing, a refused write) goes through `todo-status.tsx`.
 */
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

/** Told about each write the API took: the To-do as it saved it. */
export type WriteListener = { saved?: (todo: Todo) => void };

/** A delete the page offers to undo: the To-do's id and title, and why the last Undo failed. */
type Notice = { id: string; title: string; error?: string };

type WriteResult = ActionResult<{ todo: Todo }> | TodoWriteFailure;

/** How long the strike takes to draw (TodoTitle's transition): the row stays in place until it is done. */
const STRIKE_MS = 300;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The Personal Space's writes (docs/personal-space.md §7.5): edits, position moves (drag) and deletes. Each one shows
 * at once (an optimistic copy of the API's rules) and goes back, with an error under the row, if the API refuses it.
 * Two edits ask first: moving a To-do with a Reminder to Anytime, and closing a parent the API says still has open
 * Sub-to-dos (its 409 `openSubTodos`), which is retried with `closeSubTodos: true` once confirmed.
 */
export function useTodoWrites(todos: Todo[], today: string, timeZone: string, projects: readonly ProjectOption[], listener: WriteListener = {}) {
  // The deletes the API took, applied to whatever copies of those To-dos the page still holds (a Logbook page read
  // before the delete), with the same cascade as the optimistic delete. An id leaves once no copy is left.
  const [deleted, setDeleted] = useState<string[]>([]);
  const held = useMemo(() => deleted.filter((id) => todos.some((t) => t.id === id)), [deleted, todos]);
  const remaining = useMemo(() => held.reduce((list, id) => applyTodoChange(list, { type: "delete", id }), todos), [held, todos]);
  useEffect(() => {
    const gone = deleted.filter((id) => !held.includes(id));
    if (gone.length) setDeleted((ids) => ids.filter((id) => !gone.includes(id)));
  }, [deleted, held]);
  const [shown, addChange] = useOptimistic(remaining, applyTodoChange);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // The To-dos whose strike is drawing, and the state they show meanwhile.
  const [previews, setPreviews] = useState<Record<string, Todo["state"]>>({});
  const striking = useRef(new Set<string>());
  // What the rows read of `previews` and `errors`, one To-do at a time (todo-status.tsx). The commit that changes them
  // tells the rows, so they show it before the browser paints.
  const [status] = useState(createTodoStatusStore);
  useLayoutEffect(() => status.set({ previews, errors }), [status, previews, errors]);

  /**
   * Closing or reopening a To-do (from its check, the "…" menu or the details panel) draws the strike first (about
   * 300 ms, none under reduced motion), then sends the write. The preview is cleared with the write's own render, so
   * the check never flashes back before the new state shows. A second try while it draws is ignored.
   */
  const strike = async (todo: Todo, state: Todo["state"], save: () => Promise<void>) => {
    if (striking.current.has(todo.id)) return;
    if (reducedMotion()) return save();
    striking.current.add(todo.id);
    setPreviews((current) => ({ ...current, [todo.id]: state }));
    await new Promise((resolve) => setTimeout(resolve, STRIKE_MS));
    try {
      await save();
    } finally {
      striking.current.delete(todo.id);
      startTransition(() =>
        setPreviews((current) => {
          const { [todo.id]: _, ...rest } = current;
          return rest;
        }),
      );
    }
  };

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
      optimistic ? { type: "update", id: todo.id, patch, at: latestInstantOn(today, timeZone).toISOString(), now: ownerNow(timeZone), projects } : null,
      () => updateTodoAction(todo.id, patch, todo.updatedAt),
      (result) => {
        if (result.openSubTodos && isClosing(patch)) {
          setConfirm({ kind: "close", todo, patch: { state: patch.state, closeSubTodos: true }, state: patch.state, count: result.openSubTodos });
        } else {
          setError(todo.id, firstError(result));
        }
      },
    );

  const writes = {
    update(todo: Todo, patch: TodoPatch) {
      if (patch.day === null && hasPendingReminder(todo) && patch.time === undefined) {
        setConfirm({ kind: "anytime", todo, patch });
        return Promise.resolve();
      }
      // A parent known to have open Sub-to-dos stays as it is until the API answers: its 409 opens the confirm.
      const openSubTodos = todo.subTodos ? todo.subTodos.total - todo.subTodos.done : 0;
      const send = () => write(todo, patch, !(isClosing(patch) && !patch.closeSubTodos && openSubTodos > 0));
      return patch.state !== undefined && patch.state !== todo.state ? strike(todo, patch.state, send) : send();
    },
    move(todo: Todo, move: TodoMove) {
      return run(
        todo,
        { type: "move", id: todo.id, ...move },
        () => moveTodoAction(todo.id, move),
        (result) => setError(todo.id, `Couldn't reorder it. ${firstError(result)}`),
      );
    },
    deleteTodo(todo: Todo) {
      startTransition(async () => {
        setError(todo.id, null);
        addChange({ type: "delete", id: todo.id });
        const result = await deleteTodoAction(todo.id);
        startTransition(() => {
          if (result.ok) {
            setDeleted((ids) => [...ids, todo.id]);
            setNotices((list) => [...list.filter((n) => n.id !== todo.id), { id: todo.id, title: todo.title }]);
          } else {
            setError(todo.id, result.error);
          }
        });
      });
    },
    dismissError: (id: string) => setError(id, null),
  };
  // The newest render's writes, behind an object that doesn't change with it. Set before any layout effect runs, so a
  // call made during a commit never sees the render before.
  const latest = useRef(writes);
  useInsertionEffect(() => {
    latest.current = writes;
  });
  const actions = useMemo<TodoActions>(
    () => ({
      today,
      timeZone,
      update: (todo, patch) => latest.current.update(todo, patch),
      move: (todo, move) => latest.current.move(todo, move),
      deleteTodo: (todo) => latest.current.deleteTodo(todo),
      dismissError: (id) => latest.current.dismissError(id),
    }),
    [today, timeZone],
  );

  const accept = () => {
    if (!confirm) return;
    setConfirm(null);
    void write(confirm.todo, confirm.patch, true);
  };

  /** The undo of a delete: the To-do comes back with the Sub-to-dos deleted with it. */
  const undo = async (notice: Notice) => {
    const result = await restoreTodoAction(notice.id);
    startTransition(() => {
      if (result.ok) {
        setDeleted((ids) => ids.filter((id) => id !== notice.id));
        setNotices((list) => list.filter((n) => n.id !== notice.id));
      } else {
        setNotices((list) => list.map((n) => (n.id === notice.id ? { ...n, error: result.error } : n)));
      }
    });
  };

  const dialog = <ConfirmDialog confirm={confirm} onAccept={accept} onCancel={() => setConfirm(null)} />;
  const notice = <DeleteNotices notices={notices} onUndo={(n) => void undo(n)} onDismiss={(id) => setNotices((list) => list.filter((n) => n.id !== id))} />;
  return { todos: shown, actions, status, dialog, notice };
}

/** One line per delete that can still be undone (docs/personal-space.md §7.5), above the lists, until dismissed. */
function DeleteNotices({ notices, onUndo, onDismiss }: { notices: Notice[]; onUndo: (notice: Notice) => void; onDismiss: (id: string) => void }) {
  return notices.map((n) => (
    <UndoNotice key={n.id} error={n.error} undoLabel={`Undo delete of “${n.title}”`} onUndo={() => onUndo(n)} onDismiss={() => onDismiss(n.id)}>
      <span className="font-medium">“{n.title}”</span> moved to the Trash.
    </UndoNotice>
  ));
}

function confirmText(confirm: Confirm): { title: string; body: ReactNode; action: string } {
  const name = <span className="font-medium text-foreground">“{confirm.todo.title}”</span>;
  if (confirm.kind === "anytime") {
    return {
      title: "Move to Anytime?",
      body: (
        <>
          {name} loses its {confirm.todo.reminder?.time} Reminder: an Anytime To-do has no Reminder.
        </>
      ),
      action: "Move and remove Reminder",
    };
  }
  const subTodos = plural(confirm.count, "open Sub-to-do", "open Sub-to-dos");
  const done = confirm.state === "done";
  return {
    title: done ? `Mark ${subTodos} done too?` : `Drop ${subTodos} too?`,
    body: (
      <>
        {name} has {subTodos}. A parent never closes on its own.
      </>
    ),
    action: done ? "Mark all done" : "Drop all",
  };
}

function ConfirmDialog({ confirm, onAccept, onCancel }: { confirm: Confirm | null; onAccept: () => void; onCancel: () => void }) {
  // Kept while the dialog animates out.
  const [last, setLast] = useState(confirm);
  if (confirm && confirm !== last) setLast(confirm);
  const text = last ? confirmText(last) : null;
  return (
    <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent
        // The picker or menu it came from has closed: focus goes back to the To-do's row (its check).
        onCloseAutoFocus={(e) => {
          const check = last && document.querySelector<HTMLElement>(`[data-todo-id="${last.todo.id}"] [data-todo-check]`);
          if (!check) return;
          e.preventDefault();
          check.focus();
        }}
      >
        <AlertDialogTitle>{text?.title}</AlertDialogTitle>
        <AlertDialogDescription>{text?.body}</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button size="sm" onClick={onAccept}>
              {text?.action}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
