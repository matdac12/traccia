"use client";

import { Download, ExternalLink, FileText, Paperclip, Trash2, Undo2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { deleteAttachmentAction, restoreAttachmentAction } from "@/app/(app)/issues/[identifier]/actions";
import { ActorAvatar } from "@/components/traccia/atoms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Attachment } from "@/lib/api/schemas";
import { ALLOWED_HINT, ALLOWED_TYPES, fileUrl, formatBytes, kindOf, precheck } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import { TimeAgo } from "./atoms";

type Problem = { name: string; message: string };

/** Uploads one file through the streaming route handler. Returns an error message, or null on success. */
async function upload(identifier: string, file: File): Promise<string | null> {
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch(`/api/issues/${encodeURIComponent(identifier)}/attachments`, { method: "POST", body: form });
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return body?.error?.message ?? `The upload failed (${res.status}).`;
  } catch {
    return "Could not reach the server.";
  }
}

export function Attachments({ identifier, attachments }: { identifier: string; attachments: Attachment[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [removed, setRemoved] = useState<Attachment[]>([]);
  const [preview, setPreview] = useState<Attachment | null>(null);
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
      const message = await upload(identifier, file);
      setUploading((u) => u.filter((n) => n !== file.name));
      if (message) bad.push({ name: file.name, message });
    }
    setProblems(bad);
    refresh();
  };

  const remove = async (a: Attachment) => {
    setError(null);
    setRemoved((r) => [...r, a]);
    const res = await deleteAttachmentAction(identifier, a.id);
    if (!res.ok) {
      setRemoved((r) => r.filter((x) => x.id !== a.id));
      setError(res.message);
    } else refresh();
  };

  const undo = async (a: Attachment) => {
    setError(null);
    const res = await restoreAttachmentAction(identifier, a.id);
    if (res.ok) {
      setRemoved((r) => r.filter((x) => x.id !== a.id));
      refresh();
    } else setError(res.message);
  };

  const live = attachments.filter((a) => !removed.some((r) => r.id === a.id));

  return (
    <section className="mt-8" aria-label="Attachments" data-slot="attachments">
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-medium">
        <Paperclip className="size-3.5 text-muted-foreground" />Attachments <span className="text-xs font-normal text-muted-foreground">{live.length}</span>
      </h3>

      <div className="flex flex-wrap gap-2">
        {live.map((a) => (
          <AttachmentCard key={a.id} a={a} onPreview={() => setPreview(a)} onDelete={() => remove(a)} />
        ))}
        {uploading.map((name) => (
          <div key={name} role="status" className="flex h-[54px] w-44 items-center gap-2 rounded-lg border bg-card p-2 text-xs text-muted-foreground">
            <Upload className="size-3.5 shrink-0 animate-pulse" /><span className="truncate">Uploading {name}…</span>
          </div>
        ))}
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void send([...e.dataTransfer.files]); }}
          className={cn("flex h-[54px] w-44 items-center justify-center gap-2 rounded-lg border border-dashed text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground", drag && "border-primary bg-primary/5 text-primary")}
        >
          <Upload className="size-3.5" />Drop files or click to attach
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label="Attach files"
          accept={ALLOWED_TYPES.map((t) => t.mime).join(",") + ",.md,.txt,.json"}
          onChange={(e) => { void send([...(e.target.files ?? [])]); e.target.value = ""; }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{ALLOWED_HINT}.</p>

      {removed.map((a) => (
        <p key={a.id} role="status" className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Trash2 className="size-3.5" />{a.filename} moved to Trash.
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-xs" onClick={() => undo(a)}><Undo2 className="size-3" />Undo</Button>
        </p>
      ))}
      {problems.map((p) => (
        <p key={p.name + p.message} role="alert" className="mt-2 text-xs text-destructive">{p.message}</p>
      ))}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-[min(92vw,1100px)] sm:max-w-[min(92vw,1100px)]">
          <DialogTitle className="truncate pr-6 text-sm">{preview?.filename}</DialogTitle>
          <DialogDescription className="sr-only">Image preview</DialogDescription>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(preview.id)} alt={preview.filename} className="mx-auto max-h-[75vh] max-w-full rounded-md object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AttachmentCard({ a, onPreview, onDelete }: { a: Attachment; onPreview: () => void; onDelete: () => void }) {
  const kind = kindOf(a.mimeType);
  const url = fileUrl(a.id);
  const meta = (
    <div className="min-w-0">
      <div className="truncate text-xs">{a.filename}</div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {formatBytes(a.sizeBytes)} · <ActorAvatar who={a.actor} size={12} /> <TimeAgo iso={a.createdAt} />
      </div>
    </div>
  );
  const body = (
    <>
      <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground">
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <FileText className="size-4" />
        )}
      </div>
      {meta}
    </>
  );
  const cls = "flex min-w-0 flex-1 items-center gap-2 text-left";
  return (
    <div className="group relative flex w-56 items-center gap-2 rounded-lg border bg-card p-2" data-attachment-id={a.id}>
      {kind === "image" ? (
        <button type="button" className={cls} onClick={onPreview} aria-label={`Preview ${a.filename}`}>{body}</button>
      ) : kind === "pdf" ? (
        <a className={cls} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${a.filename} in a new tab`}>{body}</a>
      ) : (
        <a className={cls} href={url} download={a.filename} aria-label={`Download ${a.filename}`}>{body}</a>
      )}
      <span className="flex shrink-0 flex-col items-center text-muted-foreground opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <a href={url} {...(kind === "pdf" ? { target: "_blank", rel: "noopener noreferrer" } : { download: a.filename })} aria-label={kind === "pdf" ? "Open in new tab" : "Download"} className="rounded p-0.5 hover:text-foreground">
          {kind === "pdf" ? <ExternalLink className="size-3.5" /> : <Download className="size-3.5" />}
        </a>
        <button type="button" aria-label={`Delete ${a.filename}`} onClick={onDelete} className="rounded p-0.5 hover:text-destructive"><Trash2 className="size-3.5" /></button>
      </span>
    </div>
  );
}
