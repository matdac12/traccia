"use client";
import { Undo2, X } from "lucide-react";
import { useRef, useState } from "react";
import { deleteIssueAction, restoreIssueAction } from "@/app/(app)/issues/[identifier]/actions";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/issue-detail/result";
import type { IssueRow } from "@/lib/api/schemas";

type Act = (identifier: string) => Promise<ActionResult>;
type State = { issue: IssueRow; error?: string };
const without = (list: State[], issue: IssueRow) => list.filter((x) => x.issue.id !== issue.id);

/**
 * Soft delete from a list or board (MAT-1762): the row leaves at once, a failure puts it back, and the notice
 * offers Undo (restore from Trash) until dismissed. Lives above the rows, so it survives the row unmounting.
 */
export function useIssueDelete({ onRemove, onRestore, remove = deleteIssueAction, restore = restoreIssueAction }: {
  onRemove: (issue: IssueRow) => void; onRestore: (issue: IssueRow) => void; remove?: Act; restore?: Act;
}) {
  /** One entry per deleted issue, so deleting a second one keeps the first one's Undo. */
  const [states, setStates] = useState<State[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  /** Non-zero while a delete is in flight: the live refresh must not bring the row back then. */
  const pending = useRef(0);

  const deleteIssue = async (issue: IssueRow) => {
    setFailed(null);
    onRemove(issue);
    setStates((l) => [...without(l, issue), { issue }]);
    pending.current++;
    try {
      const res = await remove(issue.identifier);
      if (res.ok) return;
      onRestore(issue);
      setStates((l) => without(l, issue));
      setFailed(`Could not delete ${issue.identifier} (${res.message}).`);
    } catch {
      onRestore(issue);
      setStates((l) => without(l, issue));
      setFailed(`Could not delete ${issue.identifier} (could not reach the server).`);
    } finally {
      pending.current--;
    }
  };

  const undo = async (issue: IssueRow) => {
    const fail = (error: string) => setStates((l) => l.map((x) => (x.issue.id === issue.id ? { ...x, error } : x)));
    try {
      const res = await restore(issue.identifier);
      if (res.ok) { onRestore(issue); setStates((l) => without(l, issue)); } else fail(res.message);
    } catch {
      fail("Could not reach the server.");
    }
  };

  const notice = (
    <>
      {states.map((state) => (
        <div key={state.issue.id} role="status" className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs">
          <span className="flex-1">{state.issue.identifier} moved to Trash.{state.error && <span role="alert" className="ml-2 text-destructive">Undo failed: {state.error}</span>}</span>
          <Button type="button" size="sm" variant="outline" className="h-6 gap-1 text-xs" aria-label={`Undo delete of ${state.issue.identifier}`} onClick={() => void undo(state.issue)}><Undo2 className="size-3.5" />Undo</Button>
          <Button type="button" variant="ghost" size="icon" className="size-5" aria-label="Dismiss" onClick={() => setStates((l) => without(l, state.issue))}><X className="size-3.5" /></Button>
        </div>
      ))}
      {failed && (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <span className="flex-1">{failed}</span>
          <Button type="button" variant="ghost" size="icon" className="size-5" aria-label="Dismiss" onClick={() => setFailed(null)}><X className="size-3.5" /></Button>
        </div>
      )}
    </>
  );

  return { deleteIssue, notice, pending };
}
