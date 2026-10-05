"use client";
import { Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { updateProjectDescriptionAction } from "@/app/(app)/projects/[id]/actions";
import { ConflictNotice } from "@/components/traccia/conflict-notice";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Markdown description with an inline editor. Raw HTML in the markdown is not rendered. */
export function ProjectDescription({ projectId, description, updatedAt }: { projectId: string; description: string; updatedAt: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const res = await updateProjectDescriptionAction(projectId, draft, updatedAt);
      if (res.ok) {
        setError(null);
        setConflict(false);
        setEditing(false);
      } else {
        // On a conflict the editor stays open with the draft; Save again overwrites the latest version knowingly.
        setConflict(res.conflict === true);
        setError(res.conflict ? null : res.error);
      }
    });

  if (editing) {
    return (
      <section aria-label="Description" className="space-y-2">
        <Textarea aria-label="Description" value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-48 font-mono text-[13px]" autoFocus />
        {conflict ? <ConflictNotice what="This project"> Your draft is kept below; Save again to overwrite the latest version.</ConflictNotice> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setDraft(description); setError(null); setConflict(false); setEditing(false); }}>Cancel</Button>
        </div>
      </section>
    );
  }
  return (
    <section aria-label="Description" className="group relative">
      <Button variant="ghost" size="sm" className="absolute right-0 top-0 h-6 gap-1 text-xs text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100" onClick={() => { setDraft(description); setEditing(true); }}>
        <Pencil className="size-3" />Edit
      </Button>
      {description.trim() ? (
        <div className="md max-w-2xl"><ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown></div>
      ) : (
        <p className="text-[13px] text-muted-foreground">No description. Use Edit to add one.</p>
      )}
    </section>
  );
}
