"use client";
import { useState, useTransition } from "react";
import { createLabelInPlaceAction } from "@/app/(app)/issues/label-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Label } from "@/lib/api/schemas";

const DEFAULT_COLOR = "#6b7280";

/**
 * Inline "create label" form for the label dropdowns (create dialog, issue detail). Same fields as
 * the project page: name, colour and project-scoped or global. 
 */
export function NewLabelForm({ projectId, onCreated, onCancel }: { projectId: string; onCreated: (label: Label) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [global, setGlobal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function submit() {
    if (pending) return;
    start(async () => {
      setError(null);
      setFields({});
      const res = await createLabelInPlaceAction(projectId, { name, color, scoped: !global }).catch(() => null);
      if (!res) setError("Something went wrong.");
      else if (res.ok) onCreated(res.data);
      else {
        setError(res.error);
        setFields(res.fieldErrors);
      }
    });
  }

  // Not a <form>: the dialog and dropdown that host this swallow nested submits, so Enter and Escape are handled here.
  return (
    <fieldset
      className="space-y-1.5 p-2"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          submit();
        }
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="flex items-center gap-2">
        <input type="color" aria-label="Label color" value={color} onChange={(e) => setColor(e.target.value)} className="size-7 shrink-0 cursor-pointer rounded border bg-transparent p-0.5" />
        <Input aria-label="Label name" autoFocus placeholder="Label name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={fields.name ? true : undefined} className="h-7 text-[13px]" />
        <Button type="button" size="xs" disabled={pending || !name.trim()} onClick={submit}>Create</Button>
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} />
        Global (usable in every project)
      </label>
      {fields.name ? <p className="text-xs text-destructive">Name {fields.name}</p> : null}
      {fields.color ? <p className="text-xs text-destructive">Color {fields.color}</p> : null}
      {error && !fields.name && !fields.color ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </fieldset>
  );
}
