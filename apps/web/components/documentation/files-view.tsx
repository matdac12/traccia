"use client";
import { Download, ExternalLink, FileText, Files, Pencil, RefreshCw, Trash2, Undo2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { deleteDocumentAction, restoreDocumentationAction, updateDocumentAction } from "@/app/(app)/projects/[id]/documentation/actions";
import { TimeAgo } from "@/components/issue-detail/atoms";
import { ConfirmButton } from "@/components/project/confirm-button";
import { ActorAvatar } from "@/components/traccia/atoms";
import { ConflictNotice } from "@/components/traccia/conflict-notice";
import { EmptyState } from "@/components/traccia/empty-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectDocument } from "@/lib/api/schemas";
import { ALLOWED_HINT, ALLOWED_TYPES, formatBytes, kindOf, precheck } from "@/lib/attachments";
import { DOCUMENT_DESCRIPTION_MAX } from "@/lib/documentation";
import { cn } from "@/lib/utils";

const fileHref = (id: string) => `/api/files/doc/${id}`;
const ACCEPT = ALLOWED_TYPES.map((t) => t.mime).join(",") + ",.md,.txt,.json";

/** Uploads one file through the streaming route handler. Returns an error message, or null on success. */
async function upload(projectId: string, file: File, description: string): Promise<string | null> {
  const form = new FormData();
  form.append("file", file);
  if (description) form.append("description", description);
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents`, { method: "POST", body: form });
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return body?.error?.message ?? `The upload failed (${res.status}).`;
  } catch {
    return "Could not reach the server.";
  }
}

type Problem = { name: string; message: string };

export function FilesView({ projectId, documents, query }: { projectId: string; documents: ProjectDocument[]; query: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replacing = useRef<ProjectDocument | null>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [removed, setRemoved] = useState<ProjectDocument[]>([]);
  const [editing, setEditing] = useState<ProjectDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => startTransition(() => router.refresh());

  const send = async (files: File[]) => {
    if (files.length === 0) return;
    setProblems([]);
    const bad: Problem[] = [];
    for (const file of files) {
      const refusal = precheck(file);
      if (refusal) {
        bad.push({ name: file.name, message: refusal });
        continue;
      }
      setUploading((u) => [...u, file.name]);
      const message = await upload(projectId, file, "");
      setUploading((u) => u.filter((n) => n !== file.name));
      if (message) bad.push({ name: file.name, message });
    }
    setProblems(bad);
    refresh();
  };

  /** The API never changes a document's bytes, so replacing uploads the new file (keeping the description) and then moves the old one to Trash. */
  const replace = async (old: ProjectDocument, file: File) => {
    setProblems([]);
    const refusal = precheck(file);
    if (refusal) return setProblems([{ name: file.name, message: refusal }]);
    setUploading((u) => [...u, file.name]);
    const message = await upload(projectId, file, old.description);
    setUploading((u) => u.filter((n) => n !== file.name));
    if (message) return setProblems([{ name: file.name, message }]);
    const res = await deleteDocumentAction(projectId, old.id);
    if (!res.ok) setProblems([{ name: old.filename, message: `${file.name} was uploaded, but ${old.filename} could not be removed: ${res.error}` }]);
    refresh();
  };

  const remove = async (d: ProjectDocument) => {
    setError(null);
    const res = await deleteDocumentAction(projectId, d.id);
    if (!res.ok) return setError(res.error);
    setRemoved((r) => [...r, d]);
    refresh();
  };
  const undo = async (d: ProjectDocument) => {
    setError(null);
    const res = await restoreDocumentationAction(projectId, "document", d.id);
    if (!res.ok) return setError(res.error);
    setRemoved((r) => r.filter((x) => x.id !== d.id));
    refresh();
  };

  const live = documents.filter((d) => !removed.some((r) => r.id === d.id));

  return (
    <div className="px-4 py-4 sm:px-6">
      <fieldset
        aria-label="Upload documents"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void send([...e.dataTransfer.files]); }}
        className={cn("mb-3 flex items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground transition-colors", drag && "border-primary bg-primary/5 text-primary")}
      >
        <Upload className="size-3.5 shrink-0" />
        <span>Drop files here or <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => input.current?.click()}>choose files</button>. {ALLOWED_HINT}.</span>
        <input ref={input} type="file" multiple hidden aria-label="Choose documents to upload" accept={ACCEPT} onChange={(e) => { void send([...(e.target.files ?? [])]); e.target.value = ""; }} />
        <input
          ref={replaceInput}
          type="file"
          hidden
          aria-label="Replace document"
          accept={ACCEPT}
          onChange={(e) => {
            const file = e.target.files?.[0];
            const old = replacing.current;
            e.target.value = "";
            if (file && old) void replace(old, file);
          }}
        />
      </fieldset>

      {uploading.map((name) => (
        <p key={name} role="status" className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><Upload className="size-3.5 animate-pulse" />Uploading {name}…</p>
      ))}
      {removed.map((d) => (
        <p key={d.id} role="status" className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Trash2 className="size-3.5" />{d.filename} moved to Trash.
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-xs" onClick={() => undo(d)}><Undo2 className="size-3" />Undo</Button>
        </p>
      ))}
      {problems.map((p) => <p key={p.name + p.message} role="alert" className="mb-2 text-xs text-destructive">{p.message}</p>)}
      {error ? <p role="alert" className="mb-2 text-xs text-destructive">{error}</p> : null}

      {live.length === 0 ? (
        <EmptyState icon={Files} title={query ? "No matching documents" : "No documents yet"}>
          {query ? "Try a different search." : "Upload PDFs, images or text files that everyone working on this project should have."}
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-lg border">
          {live.map((d) => (
            <DocumentRow
              key={d.id}
              d={d}
              onEdit={() => setEditing(d)}
              onReplace={() => { replacing.current = d; replaceInput.current?.click(); }}
              onDelete={() => remove(d)}
            />
          ))}
        </ul>
      )}

      <EditDialog key={editing?.id ?? "closed"} projectId={projectId} doc={editing} onClose={() => setEditing(null)} onSaved={refresh} />
    </div>
  );
}

function DocumentRow({ d, onEdit, onReplace, onDelete }: { d: ProjectDocument; onEdit: () => void; onReplace: () => void; onDelete: () => void }) {
  const kind = kindOf(d.mimeType);
  const url = fileHref(d.id);
  const newTab = kind !== "file";
  return (
    <li className="group flex items-start gap-3 px-3 py-2.5" data-document-id={d.id}>
      <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground">
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <FileText className="size-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <a href={url} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : { download: d.filename })} className="block truncate text-[13px] font-medium hover:underline">{d.filename}</a>
        {d.description ? <p className="line-clamp-2 text-xs text-muted-foreground">{d.description}</p> : null}
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          {formatBytes(d.sizeBytes)} · {d.mimeType} · <ActorAvatar who={d.createdBy} size={12} /> <TimeAgo iso={d.updatedAt} />
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
        <Button asChild variant="ghost" size="xs" aria-label={newTab ? `Open ${d.filename} in a new tab` : `Download ${d.filename}`}>
          <a href={url} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : { download: d.filename })}>{newTab ? <ExternalLink /> : <Download />}</a>
        </Button>
        <Button variant="ghost" size="xs" aria-label={`Edit ${d.filename}`} onClick={onEdit}><Pencil /></Button>
        <Button variant="ghost" size="xs" aria-label={`Replace ${d.filename}`} onClick={onReplace}><RefreshCw /></Button>
        <ConfirmButton onConfirm={onDelete} label={`Delete ${d.filename}`} confirmLabel="Move to Trash"><Trash2 /></ConfirmButton>
      </div>
    </li>
  );
}

/** Rename and re-describe; the bytes never change. */
function EditDialog({ projectId, doc, onClose, onSaved }: { projectId: string; doc: ProjectDocument | null; onClose: () => void; onSaved: () => void }) {
  const [filename, setFilename] = useState(doc?.filename ?? "");
  const [description, setDescription] = useState(doc?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [pending, start] = useTransition();

  const save = () => {
    if (!doc) return;
    start(async () => {
      setError(null);
      setFieldErrors({});
      const res = await updateDocumentAction(projectId, doc.id, { filename, description }, doc.updatedAt).catch(() => null);
      if (!res) return setError("Something went wrong. Check whether the document was saved before retrying.");
      if (res.ok) {
        onSaved();
        return onClose();
      }
      setConflict(res.conflict === true);
      setError(res.conflict ? null : res.error);
      setFieldErrors(res.fieldErrors);
    });
  };

  return (
    <Dialog open={doc !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="text-sm font-medium">Edit document</DialogTitle>
          <DialogDescription className="sr-only">Rename or re-describe the document</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 px-4 pb-3 pt-2">
          <Input autoFocus aria-label="Name" aria-invalid={fieldErrors.filename ? true : undefined} value={filename} onChange={(e) => setFilename(e.target.value)} className="h-8 text-[13px]" />
          {fieldErrors.filename ? <p className="text-xs text-destructive">{fieldErrors.filename}</p> : null}
          <Textarea aria-label="Description" value={description} maxLength={DOCUMENT_DESCRIPTION_MAX} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" className="min-h-24 text-[13px]" />
          {fieldErrors.description ? <p className="text-xs text-destructive">{fieldErrors.description}</p> : null}
        </div>
        {conflict ? <div className="px-4 pb-2"><ConflictNotice what="This document"> Your changes are kept; Save again to overwrite the latest version.</ConflictNotice></div> : null}
        {error ? <p role="alert" className="border-t px-4 py-2 text-xs text-destructive">{error}</p> : null}
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
