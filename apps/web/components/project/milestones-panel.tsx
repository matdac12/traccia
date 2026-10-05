"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import {
  createMilestoneAction,
  deleteMilestoneAction,
  updateMilestoneAction,
  type MilestoneFormValues,
} from "@/app/(app)/projects/[id]/actions";
import { ConflictNotice } from "@/components/traccia/conflict-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import type { Milestone } from "@/lib/api/schemas";
import { MilestoneRow } from "./milestone-row";
import { ConfirmButton } from "./confirm-button";

function MilestoneForm({ initial, submitLabel, onSubmit, onCancel }: { initial: MilestoneFormValues; submitLabel: string; onSubmit: (v: MilestoneFormValues) => Promise<ActionResult>; onCancel: () => void }) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const res = await onSubmit(values);
      setConflict(false);
      if (res.ok) return;
      setConflict(res.conflict === true);
      setError(res.error);
      setFields(res.fieldErrors);
    });
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Input aria-label="Milestone name" autoFocus placeholder="Milestone name" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} aria-invalid={fields.name ? true : undefined} className="h-8 text-[13px]" />
      {fields.name ? <p className="text-xs text-destructive">Name {fields.name}</p> : null}
      <Input aria-label="Target date" type="date" value={values.targetDate} onChange={(e) => setValues({ ...values, targetDate: e.target.value })} aria-invalid={fields.targetDate ? true : undefined} className="h-8 text-[13px]" />
      {fields.targetDate ? <p className="text-xs text-destructive">Target date {fields.targetDate}</p> : null}
      {conflict ? <ConflictNotice what="This milestone"> Your edit is kept; Save again to overwrite the latest version.</ConflictNotice> : null}
      {error && !conflict && !fields.name && !fields.targetDate ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="xs" disabled={pending}>{submitLabel}</Button>
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function MilestoneItem({ projectId, milestone }: { projectId: string; milestone: Milestone }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const remove = () =>
    start(async () => {
      const res = await deleteMilestoneAction(projectId, milestone.id);
      if (!res.ok) setError(res.error);
    });
  if (editing) {
    return (
      <li className="py-2.5">
        <MilestoneForm
          initial={{ name: milestone.name, targetDate: milestone.targetDate ?? "" }}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            const res = await updateMilestoneAction(projectId, milestone.id, v, milestone.updatedAt);
            if (res.ok) setEditing(false);
            return res;
          }}
        />
      </li>
    );
  }
  return (
    <li className="group relative">
      <div className="flex items-center gap-2.5 py-2">
        <MilestoneRow milestone={milestone} href={`/projects/${projectId}/issues?milestone=${encodeURIComponent(milestone.id)}`} />
        {/* Always visible without hover (touch), faded in on hover or focus where hover exists. */}
        <div className="relative z-10 flex shrink-0 items-center transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Edit ${milestone.name}`} className="text-muted-foreground" onClick={() => setEditing(true)}><Pencil /></Button>
          <ConfirmButton label={`Delete ${milestone.name}`} disabled={pending} onConfirm={remove}><Trash2 className="size-3" /></ConfirmButton>
        </div>
      </div>
      {error ? <p role="alert" className="pb-2 pl-6 text-xs text-destructive">{error}</p> : null}
    </li>
  );
}

export function MilestonesPanel({ projectId, milestones }: { projectId: string; milestones: Milestone[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <section aria-label="Milestones">
      <div className="mb-1 flex h-6 items-center">
        <h2 className="text-[13px] font-medium">Milestones</h2>
        {milestones.length ? <span className="ml-2 text-xs tabular-nums text-muted-foreground">{milestones.length}</span> : null}
        <Button variant="ghost" size="icon-xs" className="ml-auto text-muted-foreground" aria-label="Add milestone" onClick={() => setAdding(true)}><Plus /></Button>
      </div>
      {milestones.length > 0 || adding ? (
        <ul className="divide-y border-y">
          {adding ? (
            <li className="py-2.5">
              <MilestoneForm
                initial={{ name: "", targetDate: "" }}
                submitLabel="Add milestone"
                onCancel={() => setAdding(false)}
                onSubmit={async (v) => {
                  const res = await createMilestoneAction(projectId, v);
                  if (res.ok) setAdding(false);
                  return res;
                }}
              />
            </li>
          ) : null}
          {milestones.map((m) => <MilestoneItem key={m.id} projectId={projectId} milestone={m} />)}
        </ul>
      ) : null}
      {milestones.length === 0 && !adding ? <p className="pt-2 text-xs text-muted-foreground">No milestones yet. Use + to add one.</p> : null}
    </section>
  );
}
