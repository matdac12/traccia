"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { createLabelAction, deleteLabelAction, updateLabelAction } from "@/app/(app)/projects/[id]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import type { Label } from "@/lib/api/schemas";
import { ConfirmButton } from "./confirm-button";

const DEFAULT_COLOR = "#6b7280";

function LabelForm({ initial, scopable, submitLabel, onSubmit, onCancel }: { initial: { name: string; color: string; scoped: boolean }; scopable: boolean; submitLabel: string; onSubmit: (v: { name: string; color: string; scoped: boolean }) => Promise<ActionResult>; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-1.5 py-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await onSubmit(v);
          if (res.ok) return;
          setError(res.error);
          setFields(res.fieldErrors);
        });
      }}
    >
      <div className="flex items-center gap-2">
        <input type="color" aria-label="Label color" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} className="size-7 shrink-0 cursor-pointer rounded border bg-transparent p-0.5" />
        <Input aria-label="Label name" autoFocus placeholder="Label name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-invalid={fields.name ? true : undefined} className="h-7 text-[13px]" />
        <Button type="submit" size="xs" disabled={pending}>{submitLabel}</Button>
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      {scopable ? (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={!v.scoped} onChange={(e) => setV({ ...v, scoped: !e.target.checked })} />
          Global (usable in every project)
        </label>
      ) : null}
      {fields.name ? <p className="text-xs text-destructive">Name {fields.name}</p> : null}
      {fields.color ? <p className="text-xs text-destructive">Color {fields.color}</p> : null}
      {error && !fields.name && !fields.color ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

function LabelRow({ projectId, label }: { projectId: string; label: Label }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (editing) {
    return (
      <li>
        <LabelForm
          initial={{ name: label.name, color: label.color, scoped: true }}
          scopable={false}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async ({ name, color }) => {
            const res = await updateLabelAction(projectId, label.id, { name, color });
            if (res.ok) setEditing(false);
            return res;
          }}
        />
      </li>
    );
  }
  return (
    <li className="group flex h-8 items-center gap-2 text-[13px]">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: label.color }} />
      <span className="truncate">{label.name}</span>
      <span className="text-[11px] text-muted-foreground">{label.projectId ? "project" : "global"}</span>
      <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Edit ${label.name}`} onClick={() => setEditing(true)}><Pencil /></Button>
        <ConfirmButton
          label={`Delete ${label.name}`}
          disabled={pending}
          onConfirm={() => start(async () => { const res = await deleteLabelAction(projectId, label.id); if (!res.ok) setError(res.error); })}
        >
          <Trash2 />
        </ConfirmButton>
      </span>
    </li>
  );
}

/** Labels an issue of this project can use: the project's own plus the global ones. */
export function LabelsPanel({ projectId, labels }: { projectId: string; labels: Label[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <section aria-label="Labels">
      <div className="mb-1 flex items-center">
        <h2 className="text-[13px] font-medium">Labels</h2>
        <Button variant="ghost" size="icon" className="ml-auto size-6" aria-label="Add label" onClick={() => setAdding(true)}><Plus className="size-3.5" /></Button>
      </div>
      <p className="mb-1 text-[11px] text-muted-foreground">Deleting a label removes it from every issue and cannot be undone.</p>
      {adding ? (
        <LabelForm
          initial={{ name: "", color: DEFAULT_COLOR, scoped: true }}
          scopable
          submitLabel="Add label"
          onCancel={() => setAdding(false)}
          onSubmit={async (v) => {
            const res = await createLabelAction(projectId, v);
            if (res.ok) setAdding(false);
            return res;
          }}
        />
      ) : null}
      <ul className="divide-y">
        {labels.map((l) => <LabelRow key={l.id} projectId={projectId} label={l} />)}
      </ul>
      {labels.length === 0 && !adding ? <p className="text-xs text-muted-foreground">No labels yet.</p> : null}
    </section>
  );
}
