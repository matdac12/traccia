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
import { MilestoneSummary } from "./milestone-card";
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
  return (
    <div className="group relative rounded-lg border bg-card p-3">
      {editing ? (
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
      ) : (
        <>
          <MilestoneSummary milestone={milestone} />
          <div className="absolute -top-3 right-2 flex items-center gap-1 rounded-md border bg-card px-0.5 shadow-sm opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setEditing(true)}><Pencil />Edit</Button>
            <ConfirmButton label="Delete milestone" disabled={pending} onConfirm={remove}><Trash2 />Delete</ConfirmButton>
          </div>
          {error ? <p role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
        </>
      )}
    </div>
  );
}

export function MilestonesPanel({ projectId, milestones }: { projectId: string; milestones: Milestone[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <section aria-label="Milestones">
      <div className="mb-2 flex items-center">
        <h2 className="text-[13px] font-medium">Milestones</h2>
        <Button variant="ghost" size="icon" className="ml-auto size-6" aria-label="Add milestone" onClick={() => setAdding(true)}><Plus className="size-3.5" /></Button>
      </div>
      <div className="space-y-2">
        {adding ? (
          <div className="rounded-lg border bg-card p-3">
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
          </div>
        ) : null}
        {milestones.map((m) => <MilestoneItem key={m.id} projectId={projectId} milestone={m} />)}
        {milestones.length === 0 && !adding ? <p className="text-xs text-muted-foreground">No milestones yet.</p> : null}
      </div>
    </section>
  );
}
