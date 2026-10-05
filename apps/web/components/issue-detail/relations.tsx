"use client";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { createSubIssueAction, linkSubIssueAction } from "@/app/(app)/issues/[identifier]/actions";
import { ActorAvatar, StatusIcon } from "@/components/traccia/atoms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Issue, IssueRef } from "@/lib/api/schemas";
import { IssuePicker } from "./issue-picker";

const row = "flex h-9 items-center gap-2 border-b px-3 text-[13px] last:border-0 hover:bg-accent/50";

export function SubIssues({ parentIdentifier, items }: { parentIdentifier: string; items: Issue[] }) {
  const [adding, setAdding] = useState<null | "create" | "link">(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = items.filter((c) => c.status === "done").length;

  const add = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await createSubIssueAction(parentIdentifier, title);
    setBusy(false);
    if (res.ok) {
      setTitle("");
      setAdding(null);
    } else setError(res.message);
  };

  const link = async (child: IssueRef) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await linkSubIssueAction(parentIdentifier, child.identifier);
    setBusy(false);
    if (res.ok) setAdding(null);
    else setError(res.message);
  };

  return (
    <section className="mt-8" aria-label="Sub-issues">
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-medium">
        Sub-issues <span className="text-xs font-normal text-muted-foreground">{done}/{items.length}</span>
        <Button variant="ghost" size="sm" className="ml-auto h-6 gap-1 px-1.5 text-xs text-muted-foreground" onClick={() => setAdding((a) => (a ? null : "create"))}><Plus className="size-3" />Add</Button>
      </h3>
      {items.length === 0 && !adding && <p className="text-xs text-muted-foreground">No sub-issues.</p>}
      {items.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          {items.map((s) => (
            <Link key={s.id} href={`/issues/${s.identifier}`} className={row}>
              <StatusIcon status={s.status} />
              <span className="font-mono text-xs text-muted-foreground">{s.identifier}</span>
              <span className="truncate">{s.title}</span>
              <span className="ml-auto"><ActorAvatar who={s.assignee} size={16} /></span>
            </Link>
          ))}
        </div>
      )}
      {adding && (
        <div className="mt-2 space-y-1">
          <div className="flex gap-1 text-xs" role="tablist" aria-label="Add sub-issue">
            <Button size="xs" variant={adding === "create" ? "secondary" : "ghost"} role="tab" aria-selected={adding === "create"} onClick={() => { setAdding("create"); setError(null); }}>Create new</Button>
            <Button size="xs" variant={adding === "link" ? "secondary" : "ghost"} role="tab" aria-selected={adding === "link"} onClick={() => { setAdding("link"); setError(null); }}>Link existing</Button>
          </div>
          {adding === "create" ? (
            <div className="flex gap-2">
              <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") setAdding(null); }} placeholder="Sub-issue title" aria-label="Sub-issue title" className="h-8 text-[13px] md:text-[13px]" />
              <Button size="sm" disabled={!title.trim() || busy} onClick={add}>Create</Button>
              <Button size="sm" variant="ghost" onClick={() => { setAdding(null); setError(null); }}>Cancel</Button>
            </div>
          ) : (
            <IssuePicker autoFocus exclude={[parentIdentifier, ...items.map((c) => c.identifier)]} placeholder="Issue to link as a sub-issue…" onPick={link} />
          )}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </section>
  );
}

/** "Blocked by" or "Blocks": a list with remove buttons and an identifier search to add. */
export function BlockerList({ title, issues, exclude, onAdd, onRemove, disabled }: {
  title: string;
  issues: IssueRef[];
  exclude: readonly string[];
  onAdd: (issue: IssueRef) => void;
  onRemove: (issue: IssueRef) => void;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="mt-6" aria-label={title}>
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-medium">
        {title} <span className="text-xs font-normal text-muted-foreground">{issues.length}</span>
        <Button variant="ghost" size="sm" disabled={disabled} className="ml-auto h-6 gap-1 px-1.5 text-xs text-muted-foreground" onClick={() => setAdding((a) => !a)}><Plus className="size-3" />Add</Button>
      </h3>
      {issues.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          {issues.map((s) => (
            <div key={s.id} className={row}>
              <Link href={`/issues/${s.identifier}`} className="flex min-w-0 flex-1 items-center gap-2">
                <StatusIcon status={s.status} />
                <span className="font-mono text-xs text-muted-foreground">{s.identifier}</span>
                <span className="truncate">{s.title}</span>
              </Link>
              <button type="button" disabled={disabled} aria-label={`Remove ${s.identifier}`} onClick={() => onRemove(s)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"><X className="size-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      {issues.length === 0 && !adding && <p className="text-xs text-muted-foreground">None.</p>}
      {adding && <div className="mt-2"><IssuePicker autoFocus exclude={exclude} onPick={(i) => { onAdd(i); setAdding(false); }} /></div>}
    </section>
  );
}
