"use client";
import { Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import { updateProjectNameAction } from "@/app/(app)/projects/[id]/actions";
import { ConflictNotice } from "@/components/traccia/conflict-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** The project name with an inline rename, and the issue key beside it (read-only: ADR 0002). */
export function ProjectTitle({ projectId, name, projectKey, updatedAt }: { projectId: string; name: string; projectKey: string; updatedAt: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, start] = useTransition();

  const cancel = () => {
    setDraft(name);
    setError(null);
    setConflict(false);
    setEditing(false);
  };
  const save = () => {
    if (pending) return;
    if (draft === name) return cancel();
    start(async () => {
      const res = await updateProjectNameAction(projectId, draft, updatedAt);
      if (res.ok) {
        setError(null);
        setConflict(false);
        setEditing(false);
      } else {
        // On a conflict the input stays open with the draft; Enter again overwrites the latest version knowingly.
        setConflict(res.conflict === true);
        setError(res.conflict ? null : (res.fieldErrors.name ? `Name ${res.fieldErrors.name}` : res.error));
      }
    });
  };

  return (
    <>
      {editing ? (
        <Input
          autoFocus
          aria-label="Project name"
          aria-invalid={error ? true : undefined}
          value={draft}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            else if (e.key === "Escape") cancel();
          }}
          className="h-7 w-64 text-[13px] font-medium"
        />
      ) : (
        <>
          <button type="button" title="Click to rename" className="truncate rounded text-left hover:underline" onClick={() => { setDraft(name); setEditing(true); }}>{name}</button>
          <Button variant="ghost" size="icon" aria-label="Rename project" className="size-6 text-muted-foreground" onClick={() => { setDraft(name); setEditing(true); }}>
            <Pencil className="size-3" />
          </Button>
        </>
      )}
      <span title="Issue key (cannot be changed)" className="rounded border px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted-foreground">{projectKey}</span>
      {editing ? (
        <>
          <Button size="xs" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          <Button size="xs" variant="ghost" onClick={cancel}>Cancel</Button>
        </>
      ) : null}
      {conflict ? <ConflictNotice what="This project"> Your name is kept; Save again to overwrite the latest version.</ConflictNotice> : null}
      {error ? <span role="alert" className="text-xs font-normal text-destructive">{error}</span> : null}
    </>
  );
}
