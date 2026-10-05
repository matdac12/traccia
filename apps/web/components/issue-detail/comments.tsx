"use client";

import { Check, CornerDownRight, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { createCommentAction, deleteCommentAction, updateCommentAction } from "@/app/(app)/issues/[identifier]/actions";
import { ActorAvatar, AgentMark } from "@/components/traccia/atoms";
import { Button } from "@/components/ui/button";
import type { Comment, Reply } from "@/lib/api/schemas";
import { buildThreads } from "@/lib/issue-detail/comments";
import { cn } from "@/lib/utils";
import { TimeAgo } from "./atoms";
import { MarkdownEditor } from "./description";
import { Markdown } from "./markdown";

/** The dashboard's token is `you`, so only its own comments are editable; the API enforces it too. */
const OWN = "you";

function message(code: string, fallback: string) {
  return code === "forbidden" ? "Only the person who wrote a comment can edit it." : fallback;
}

export function Comments({ identifier, comments }: { identifier: string; comments: Comment[] }) {
  const threads = useMemo(() => buildThreads(comments), [comments]);
  return (
    <div className="space-y-4">
      {threads.map((c) => (
        <Thread key={c.id} identifier={identifier} comment={c} />
      ))}
      <Composer identifier={identifier} parentId={null} placeholder="Leave a comment…" submitLabel="Comment" />
    </div>
  );
}

function Thread({ identifier, comment }: { identifier: string; comment: Comment }) {
  const [replying, setReplying] = useState(false);
  return (
    <div className="space-y-2">
      <CommentCard identifier={identifier} comment={comment} onReply={() => setReplying(true)} />
      {(comment.replies.length > 0 || replying) && (
        <div className="ml-5 space-y-2 border-l pl-4">
          {comment.replies.map((r) => (
            <CommentCard key={r.id} identifier={identifier} comment={r} />
          ))}
          {replying && <Composer identifier={identifier} parentId={comment.id} placeholder="Write a reply…" submitLabel="Reply" autoFocus onDone={() => setReplying(false)} onCancel={() => setReplying(false)} />}
        </div>
      )}
    </div>
  );
}

function CommentCard({ identifier, comment, onReply }: { identifier: string; comment: Reply; onReply?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = comment.actor === OWN;
  const agent = comment.actor === "agent";

  const run = async (fn: () => ReturnType<typeof updateCommentAction>, after?: () => void) => {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (res.ok) after?.();
    else setError(message(res.code, res.message));
  };

  return (
    <div className={cn("rounded-lg border p-3", agent && "border-agent/25 bg-agent/5")} data-comment-id={comment.id}>
      <div className="mb-1 flex items-center gap-2 text-xs">
        <ActorAvatar who={comment.actor} size={16} />
        <span className="font-medium">{own ? "You" : "Agent"}</span>
        {agent && <AgentMark />}
        <span className="text-muted-foreground">
          <TimeAgo iso={comment.createdAt} suffix=" ago" />
          {comment.updatedAt !== comment.createdAt && " · edited"}
        </span>
        {!editing && (
          <span className="ml-auto flex items-center gap-0.5 text-muted-foreground">
            {onReply && (
              <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" onClick={onReply}><CornerDownRight className="size-3" />Reply</Button>
            )}
            {own && (
              <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" onClick={() => { setDraft(comment.body); setEditing(true); }}><Pencil className="size-3" />Edit</Button>
            )}
            {confirmDelete ? (
              <span className="flex items-center gap-1 pl-1">
                Delete?
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-destructive" disabled={busy} onClick={() => run(() => deleteCommentAction(identifier, comment.id))}>Yes</Button>
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setConfirmDelete(false)}>No</Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" aria-label="Delete comment" className="h-6 px-1.5 text-xs hover:text-destructive" onClick={() => setConfirmDelete(true)}><Trash2 className="size-3" /></Button>
            )}
          </span>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <MarkdownEditor label="Edit comment" value={draft} onChange={setDraft} minHeight="min-h-20" autoFocus onSubmit={() => draft.trim() && run(() => updateCommentAction(identifier, comment.id, draft), () => setEditing(false))} />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !draft.trim()} onClick={() => run(() => updateCommentAction(identifier, comment.id, draft), () => setEditing(false))}><Check className="size-3.5" />Save</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Markdown>{comment.body}</Markdown>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Composer({ identifier, parentId, placeholder, submitLabel, autoFocus, onDone, onCancel }: {
  identifier: string;
  parentId: string | null;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await createCommentAction(identifier, body, parentId);
    setBusy(false);
    if (res.ok) {
      setBody("");
      onDone?.();
    } else setError(res.message);
  };
  return (
    <div className="space-y-2">
      <MarkdownEditor label={submitLabel === "Reply" ? "Reply" : "New comment"} value={body} onChange={setBody} onSubmit={submit} placeholder={placeholder} autoFocus={autoFocus} minHeight="min-h-16" />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button size="sm" disabled={!body.trim() || busy} onClick={submit}>{submitLabel}</Button>
      </div>
    </div>
  );
}
