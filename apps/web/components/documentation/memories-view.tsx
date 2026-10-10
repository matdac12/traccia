"use client";
import { BookOpen, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createMemoryAction, deleteMemoryAction, restoreDocumentationAction, updateMemoryAction } from "@/app/(app)/projects/[id]/documentation/actions";
import { Markdown } from "@/components/issue-detail/markdown";
import { TimeAgo } from "@/components/issue-detail/atoms";
import { ConfirmButton } from "@/components/project/confirm-button";
import { ActorAvatar } from "@/components/traccia/atoms";
import { ConflictNotice } from "@/components/traccia/conflict-notice";
import { EmptyState } from "@/components/traccia/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Memory } from "@/lib/api/schemas";
import { MEMORY_BODY_MAX_BYTES, MEMORY_TAGS_MAX, MEMORY_TITLE_MAX, parseTags, snippetOf } from "@/lib/documentation";
import { cn } from "@/lib/utils";

type Props = { projectId: string; memories: Memory[]; tags: string[]; activeTag: string; query: string };

const href = (projectId: string, q: string, tag: string) => {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (tag) params.set("tag", tag);
  const qs = params.toString();
  return `/projects/${projectId}/documentation${qs ? `?${qs}` : ""}`;
};

export function MemoriesView({ projectId, memories, tags, activeTag, query }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Memory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => startTransition(() => router.refresh());

  const open = memories.find((m) => m.id === openId) ?? null;
  const live = memories.filter((m) => !removed.some((r) => r.id === m.id));
  const filtered = Boolean(query || activeTag);

  const remove = async (m: Memory) => {
    setError(null);
    const res = await deleteMemoryAction(projectId, m.id);
    if (!res.ok) return setError(res.error);
    setOpenId(null);
    setRemoved((r) => [...r, m]);
    refresh();
  };
  const undo = async (m: Memory) => {
    setError(null);
    const res = await restoreDocumentationAction(projectId, "memory", m.id);
    if (!res.ok) return setError(res.error);
    setRemoved((r) => r.filter((x) => x.id !== m.id));
    refresh();
  };

  return (
    <div className="px-4 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {tags.length > 0 ? (
          <nav className="flex flex-wrap items-center gap-1" aria-label="Filter by tag">
            {tags.map((t) => (
              <Link key={t} href={href(projectId, query, t === activeTag ? "" : t)} aria-current={t === activeTag ? "true" : undefined}>
                <Badge variant={t === activeTag ? "default" : "outline"} className="font-normal">{t}</Badge>
              </Link>
            ))}
          </nav>
        ) : null}
        <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}><Plus className="size-3.5" />New memory</Button>
      </div>

      {removed.map((m) => (
        <p key={m.id} role="status" className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Trash2 className="size-3.5" />“{m.title}” moved to Trash.
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-xs" onClick={() => undo(m)}><Undo2 className="size-3" />Undo</Button>
        </p>
      ))}
      {error ? <p role="alert" className="mb-2 text-xs text-destructive">{error}</p> : null}

      {live.length === 0 ? (
        <EmptyState icon={BookOpen} title={filtered ? "No matching memories" : "No memories yet"}>
          {filtered ? "Try a different search or clear the tag filter." : "Memories are short notes about durable facts or lessons for everyone working on this project. Agents add them too."}
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-lg border">
          {live.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => setOpenId(m.id)} className="flex w-full flex-col gap-1 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium">{m.title}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                    <ActorAvatar who={m.createdBy} size={12} /><TimeAgo iso={m.updatedAt} />
                  </span>
                </span>
                {m.body.trim() ? <span className="line-clamp-2 text-xs text-muted-foreground">{snippetOf(m.body)}</span> : null}
                {m.tags.length > 0 ? (
                  <span className="flex flex-wrap gap-1">{m.tags.map((t) => <Badge key={t} variant="secondary" className="font-normal">{t}</Badge>)}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <MemoryDialog
        key={open?.id ?? "closed"}
        projectId={projectId}
        memory={open}
        open={open !== null}
        onClose={() => setOpenId(null)}
        onDelete={() => open && remove(open)}
        onSaved={refresh}
      />
      <MemoryDialog key={creating ? "new" : "new-closed"} projectId={projectId} memory={null} open={creating} onClose={() => setCreating(false)} onSaved={refresh} />
    </div>
  );
}

/** View (rendered markdown) with an Edit mode for an existing memory; the form directly for a new one (`memory` null). */
function MemoryDialog({ projectId, memory, open, onClose, onDelete, onSaved }: { projectId: string; memory: Memory | null; open: boolean; onClose: () => void; onDelete?: () => void; onSaved: () => void }) {
  const creating = memory === null && !onDelete;
  const [editing, setEditing] = useState(creating);
  const [title, setTitle] = useState(memory?.title ?? "");
  const [body, setBody] = useState(memory?.body ?? "");
  const [tagText, setTagText] = useState(memory?.tags.join(", ") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFieldErrors({});
    setConflict(false);
  }, [open]);

  const tags = parseTags(tagText);
  const save = () =>
    start(async () => {
      setError(null);
      setFieldErrors({});
      const values = { title, body, tags };
      const res = await (memory ? updateMemoryAction(projectId, memory.id, values, memory.updatedAt) : createMemoryAction(projectId, values)).catch(() => null);
      if (!res) return setError("Something went wrong. Check whether the memory was saved before retrying.");
      if (res.ok) {
        onSaved();
        if (memory) setEditing(false);
        else onClose();
        return;
      }
      // On a conflict the editor stays open with the draft; Save again overwrites the latest version knowingly.
      setConflict(res.conflict === true);
      setError(res.conflict ? null : res.error);
      setFieldErrors(res.fieldErrors);
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-2xl"
        onKeyDown={(e) => {
          if (editing && (e.metaKey || e.ctrlKey) && e.key === "Enter" && !pending) save();
        }}
      >
        {editing ? (
          <>
            <DialogHeader className="px-4 pt-4">
              <DialogTitle className="text-sm font-medium">{memory ? "Edit memory" : "New memory"}</DialogTitle>
              <DialogDescription className="sr-only">Title, markdown body and tags</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 px-4 pb-3 pt-2">
              <Input
                autoFocus
                aria-label="Title"
                aria-invalid={fieldErrors.title ? true : undefined}
                value={title}
                maxLength={MEMORY_TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="h-9 border-0 px-0 text-base font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
              {fieldErrors.title ? <p className="text-xs text-destructive">{fieldErrors.title}</p> : null}
              <Textarea aria-label="Body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Markdown…" className="min-h-56 font-mono text-[13px]" />
              {fieldErrors.body ? <p className="text-xs text-destructive">Body: {fieldErrors.body}</p> : null}
              <Input aria-label="Tags" aria-invalid={fieldErrors.tags ? true : undefined} value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="Tags, comma-separated" className="h-8 text-[13px]" />
              <p className={cn("text-[11px] text-muted-foreground", tags.length > MEMORY_TAGS_MAX && "text-destructive")}>
                {tags.length}/{MEMORY_TAGS_MAX} tags · body up to {MEMORY_BODY_MAX_BYTES / 1024} KiB · {new TextEncoder().encode(body).length} bytes used
              </p>
              {Object.entries(fieldErrors).filter(([k]) => k.startsWith("tags")).map(([k, v]) => <p key={k} className="text-xs text-destructive">Tags: {v}</p>)}
            </div>
            {conflict ? <div className="px-4 pb-2"><ConflictNotice what="This memory"> Your draft is kept; Save again to overwrite the latest version.</ConflictNotice></div> : null}
            {error ? <p role="alert" className="border-t px-4 py-2 text-xs text-destructive">{error}</p> : null}
            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => (memory ? setEditing(false) : onClose())}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : memory ? "Save" : "Create memory"}</Button>
            </div>
          </>
        ) : memory ? (
          <>
            <DialogHeader className="px-4 pt-4">
              <DialogTitle className="pr-6 text-base font-medium">{memory.title}</DialogTitle>
              <DialogDescription className="flex items-center gap-1 text-xs">
                <ActorAvatar who={memory.createdBy} size={12} />Created <TimeAgo iso={memory.createdAt} /> · updated <TimeAgo iso={memory.updatedAt} />
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
              {memory.body.trim() ? <Markdown>{memory.body}</Markdown> : <p className="text-[13px] text-muted-foreground">No body. Use Edit to add one.</p>}
              {memory.tags.length > 0 ? <div className="mt-3 flex flex-wrap gap-1">{memory.tags.map((t) => <Badge key={t} variant="secondary" className="font-normal">{t}</Badge>)}</div> : null}
            </div>
            <div className="flex items-center justify-between border-t px-4 py-2.5">
              {onDelete ? <ConfirmButton onConfirm={onDelete} label="Delete memory" confirmLabel="Move to Trash"><Trash2 />Delete</ConfirmButton> : <span />}
              <Button size="sm" variant="outline" onClick={() => { setTitle(memory.title); setBody(memory.body); setTagText(memory.tags.join(", ")); setEditing(true); }}><Pencil className="size-3.5" />Edit</Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
