"use client";
import { Undo2, X } from "lucide-react";
import { useState } from "react";
import { deleteIssueAction, restoreIssueAction } from "@/app/(app)/issues/[identifier]/actions";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/issue-detail/result";
import type { IssueRow } from "@/lib/api/schemas";

type Act = (identifier: string) => Promise<ActionResult>;
type State = { issue: IssueRow; error?: string };

/**
 * Soft delete from a list or board (MAT-1762): the row leaves at once, a failure puts it back, and the notice
 * offers Undo (restore from Trash) until dismissed. Lives above the rows, so it survives the row unmounting.
 */
export function useIssueDelete({ onRemove, onRestore, remove = deleteIssueAction, restore = restoreIssueAction }: {
  onRemove: (issue: IssueRow) => void; onRestore: (issue: IssueRow) => void; remove?: Act; restore?: Act;
}) {
  const [state, setState] = useState<State | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const deleteIssue = async (issue: IssueRow) => {
    setFailed(null);
    onRemove(issue);
    setState({ issue });
    try {
      const res = await remove(issue.identifier);
      if (res.ok) return;
      onRestore(issue);
      setState(null);
      setFailed(`Could not delete ${issue.identifier} (${res.message}).`);
    } catch {
      onRestore(issue);
      setState(null);
      setFailed(`Could not delete ${issue.identifier} (could not reach the server).`);
    }
  };

  const undo = async () => {
    if (!state) return;
    try {
      const res = await restore(state.issue.identifier);
      if (res.ok) { onRestore(state.issue); setState(null); } else setState({ ...state, error: res.message });
    } catch {
      setState({ ...state, error: "Could not reach the server." });
    }
  };

  const notice = state ? (
    <div role="status" className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs">
      <span className="flex-1">{state.issue.identifier} moved to Trash.{state.error && <span role="alert" className="ml-2 text-destructive">Undo failed: {state.error}</span>}</span>
      <Button type="button" size="sm" variant="outline" className="h-6 gap-1 text-xs" onClick={() => void undo()}><Undo2 className="size-3.5" />Undo</Button>
      <Button type="button" variant="ghost" size="icon" className="size-5" aria-label="Dismiss" onClick={() => setState(null)}><X className="size-3.5" /></Button>
    </div>
  ) : failed ? (
    <div role="alert" className="flex shrink-0 items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
      <span className="flex-1">{failed}</span>
      <Button type="button" variant="ghost" size="icon" className="size-5" aria-label="Dismiss" onClick={() => setFailed(null)}><X className="size-3.5" /></Button>
    </div>
  ) : null;

  return { deleteIssue, notice };
}
