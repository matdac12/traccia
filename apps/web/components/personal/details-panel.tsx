"use client";
import type { Todo } from "@traccia/shared";
import { Loader2, SearchX, X } from "lucide-react";
import Link from "next/link";
import type { KeyboardEvent } from "react";
import { EmptyState } from "@/components/traccia/empty-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { isTyping } from "@/lib/is-typing";
import { useMediaQuery } from "@/lib/use-media-query";
import { TodoDetails } from "./todo-details";

/** What the panel shows for the selected id: the To-do, a read still on its way, or nothing left to show. */
export type PanelContent = { kind: "todo"; todo: Todo; parent: Todo | null; subTodos: Todo[] } | { kind: "loading" } | { kind: "gone" };

/** Wide enough for the list and a 340 px panel side by side (docs/personal-space.md §7.2). */
const WIDE = "(min-width: 1180px)";

/**
 * The details panel (docs/personal-space.md §7.2, §7.6): a 340 px column on the right from 1180 px, a dialog below.
 * Closing it (Close, Esc, or the link back from a To-do that no longer exists) clears the selection.
 */
export function DetailsPanel({ content, onClose }: { content: PanelContent; onClose: () => void }) {
  // A laptop first: the server renders the column, and a phone switches to the dialog once hydrated.
  const wide = useMediaQuery(WIDE, true);
  const title = content.kind === "todo" ? content.todo.title : content.kind === "gone" ? "To-do not found" : "Loading To-do";

  if (!wide) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[85dvh] overflow-y-auto"
          // Not the first control, the check: an Enter right after opening must not close the To-do.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          // Esc in a text field belongs to the field (it cancels a title edit), not to the dialog.
          onEscapeKeyDown={(e) => {
            if (isTyping(e.target)) e.preventDefault();
          }}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <PanelBody content={content} onClose={onClose} />
        </DialogContent>
      </Dialog>
    );
  }

  const closeAndRefocus = () => {
    const id = content.kind === "todo" ? content.todo.id : null;
    onClose();
    // The panel is gone: focus goes back to the To-do's row, when the list shows it.
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-todo-id="${id}"] [data-todo-open]`)?.focus());
  };
  const onKeyDown = (e: KeyboardEvent) => {
    // Only from the panel itself (a picker opened from it is portaled, and closes on its own Esc), and not from a text
    // field, where Esc belongs to the field.
    if (e.key !== "Escape" || e.defaultPrevented || !e.currentTarget.contains(e.target as Node) || isTyping(e.target)) return;
    e.preventDefault();
    closeAndRefocus();
  };
  return (
    <aside aria-label="To-do details" onKeyDown={onKeyDown} className="w-[340px] shrink-0 overflow-y-auto border-l px-5 pb-10 pt-4">
      <div className="mb-3 flex justify-end">
        <Button variant="ghost" size="sm" onClick={closeAndRefocus} className="-mr-2 h-7 text-[11px] text-muted-foreground">
          <X className="size-3.5" aria-hidden /> Close
        </Button>
      </div>
      <PanelBody content={content} onClose={onClose} />
    </aside>
  );
}

function PanelBody({ content, onClose }: { content: PanelContent; onClose: () => void }) {
  if (content.kind === "loading") {
    return (
      <p role="status" className="flex items-center justify-center gap-2 py-10 text-[13px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading the To-do…
      </p>
    );
  }
  if (content.kind === "gone") {
    return (
      <EmptyState icon={SearchX} title="This To-do no longer exists">
        <Link
          href="/personal"
          onClick={(e) => {
            e.preventDefault();
            onClose();
          }}
          className="rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to the list
        </Link>
      </EmptyState>
    );
  }
  // Keyed by To-do, so an edit in progress never carries over to the next one selected.
  return <TodoDetails key={content.todo.id} todo={content.todo} parent={content.parent} subTodos={content.subTodos} />;
}
