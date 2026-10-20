import { Undo2, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * One line above a list for a delete that can still be undone: what happened (`children`), why the last Undo failed
 * (`error`), an Undo button and a Dismiss. Shared by the Personal Space and the issue lists.
 */
export function UndoNotice({ children, error, undoLabel, onUndo, onDismiss }: { children: ReactNode; error?: string; undoLabel: string; onUndo: () => void; onDismiss: () => void }) {
  return (
    <div role="status" className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs">
      <span className="min-w-0 flex-1">
        {children}
        {error ? (
          <span role="alert" className="ml-2 text-destructive">
            Undo failed: {error}
          </span>
        ) : null}
      </span>
      <Button type="button" size="sm" variant="outline" className="h-6 gap-1 text-xs" aria-label={undoLabel} onClick={onUndo}>
        <Undo2 className="size-3.5" aria-hidden /> Undo
      </Button>
      <Button type="button" variant="ghost" size="icon" className="size-5" aria-label="Dismiss" onClick={onDismiss}>
        <X className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}
