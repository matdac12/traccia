"use client";

import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

/** Markdown textarea with Write / Preview tabs. Reusable for comments. */
export function MarkdownEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus,
  minHeight = "min-h-40",
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  minHeight?: string;
  label: string;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) textarea.current?.focus();
  }, [autoFocus]);
  return (
    <div className="rounded-md border bg-background">
      <div className="flex gap-1 border-b px-1.5 py-1" role="tablist">
        {(["write", "preview"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded px-2 py-0.5 text-xs capitalize text-muted-foreground hover:text-foreground", tab === t && "bg-accent text-foreground")}>
            {t}
          </button>
        ))}
      </div>
      {tab === "write" ? (
        <textarea
          ref={textarea}
          aria-label={label}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (onSubmit && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
          className={cn("block w-full resize-y bg-transparent p-3 font-mono text-[13px] outline-none", minHeight)}
        />
      ) : (
        <div className={cn("p-3", minHeight)}>{value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-muted-foreground">Nothing to preview.</p>}</div>
      )}
    </div>
  );
}

export function Description({ value, onSave, onDirty }: { value: string; onSave: (next: string) => Promise<boolean>; onDirty?: (key: string, on: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  // An open editor is an edit in progress, whether or not anything was typed yet.
  useEffect(() => { onDirty?.("description", editing); return () => onDirty?.("description", false); }, [editing, onDirty]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    // On a conflict the editor stays open with the draft, so nothing typed is lost.
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-2">
        <MarkdownEditor label="Description" value={draft} onChange={setDraft} onSubmit={save} autoFocus />
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={saving} onClick={save}>Save</Button>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
          <span className="ml-auto text-[11px] text-muted-foreground">⌘↵ to save</span>
        </div>
      </div>
    );
  }
  const start = () => {
    setDraft(value);
    setEditing(true);
  };
  return (
    <div className="group relative rounded-md">
      {value ? (
        <>
          <Button variant="ghost" size="sm" className="absolute -right-1 -top-1 h-6 gap-1 text-xs text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100" onClick={start}>
            <Pencil className="size-3" />Edit
          </Button>
          <Markdown>{value}</Markdown>
        </>
      ) : (
        <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={start}>Add description…</button>
      )}
    </div>
  );
}
