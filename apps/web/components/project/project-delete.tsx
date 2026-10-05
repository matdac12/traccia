"use client";
import { Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";
import { deleteProjectAction, restoreProjectAction } from "@/app/(app)/projects/[id]/actions";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "./confirm-button";

const DeletedContext = createContext<(() => void) | null>(null);

/** Shows the project page, or, once the project is deleted, a "moved to Trash" notice with Undo (as for an issue). */
export function ProjectDeletedGate({ projectId, projectKey, name, children }: { projectId: string; projectKey: string; name: string; children: ReactNode }) {
  const [deleted, setDeleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (deleted) {
    return (
      <div className="grid flex-1 place-items-center p-6">
        <div role="status" className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-[13px] shadow-sm">
          <Trash2 className="size-4 text-muted-foreground" />
          <span><span className="font-medium">{name}</span> <span className="font-mono text-xs">({projectKey})</span> moved to Trash with its issues.</span>
          <Button size="sm" variant="outline" disabled={busy} className="h-7 gap-1.5" onClick={async () => {
            setBusy(true);
            const res = await restoreProjectAction(projectId).catch(() => null);
            setBusy(false);
            if (res?.ok) { setDeleted(false); setError(null); }
            else setError(res ? res.error : "Could not restore. Try again from Trash.");
          }}><Undo2 className="size-3.5" />Undo</Button>
          <Link href="/projects" className="text-muted-foreground hover:text-foreground">Back to projects</Link>
          {error ? <span role="alert" className="text-destructive">{error}</span> : null}
        </div>
      </div>
    );
  }
  return (
    <DeletedContext.Provider value={() => setDeleted(true)}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </DeletedContext.Provider>
  );
}

/** Delete project, with an inline confirm. Soft delete: undo from the notice or restore from Trash. */
export function DeleteProjectButton({ projectId }: { projectId: string }) {
  const markDeleted = useContext(DeletedContext);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <>
      <ConfirmButton
        label="Delete project"
        confirmLabel="Delete project and its issues"
        disabled={pending}
        onConfirm={async () => {
          setPending(true);
          setError(null);
          const res = await deleteProjectAction(projectId).catch(() => null);
          setPending(false);
          if (res?.ok) markDeleted?.();
          else setError(res ? res.error : "Something went wrong. Check whether the project was deleted.");
        }}
      />
      {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
    </>
  );
}
