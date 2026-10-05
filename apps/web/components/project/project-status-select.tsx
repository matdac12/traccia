"use client";
import { PROJECT_STATUSES, type ProjectStatus } from "@linear-matti/shared";
import { useState, useTransition } from "react";
import { updateProjectStatusAction } from "@/app/(app)/projects/[id]/actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const PROJECT_STATUS_TONE: Record<ProjectStatus, string> = {
  active: "text-[var(--st-review)]",
  paused: "text-[var(--st-progress)]",
  completed: "text-[var(--st-done)]",
  canceled: "text-muted-foreground",
};

export function ProjectStatusSelect({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Select
        value={status}
        disabled={pending}
        onValueChange={(v) =>
          start(async () => {
            const res = await updateProjectStatusAction(projectId, v);
            setError(res.ok ? null : res.error);
          })
        }
      >
        <SelectTrigger size="sm" aria-label="Project status" className={`h-6 gap-1 text-xs capitalize ${PROJECT_STATUS_TONE[status]}`}><SelectValue /></SelectTrigger>
        <SelectContent>{PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
      </Select>
      {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
    </>
  );
}
