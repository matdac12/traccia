"use client";
import { ISSUE_STATUSES, PRIORITIES, type Actor, type IssueStatus, type Priority } from "@linear-matti/shared";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { ActorAvatar, Kbd, STATUS_LABEL, StatusIcon } from "@/components/traccia/atoms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Label, Milestone } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";
import { createIssueAction, loadCreateIssueOptions } from "./actions";
import { PRIORITY_LABEL } from "./constants";
import type { CreateIssueValues } from "./form";

export type CreateIssueProject = { id: string; name: string };
export type CreateIssueDefaults = { projectId?: string; status?: IssueStatus };

const NONE = "none";

/**
 * The create-issue form in a dialog. Reusable: it only needs the project list and open state.
 * Labels and milestones are loaded for the selected project through a server action.
 */
export function CreateIssueDialog({
  open,
  onOpenChange,
  projects,
  defaults,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: CreateIssueProject[];
  defaults?: CreateIssueDefaults;
  /** Called after a successful create (e.g. to refresh the page). */
  onCreated?: (identifier: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState<IssueStatus>("backlog");
  const [priority, setPriority] = useState<Priority>(0);
  const [assignee, setAssignee] = useState<Actor | null>(null);
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [options, setOptions] = useState<{ labels: Label[]; milestones: Milestone[] }>({ labels: [], milestones: [] });
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ identifier: string; labelError: string | null } | null>(null);
  const [pending, startTransition] = useTransition();

  // Each time the dialog opens: fresh form with the caller's defaults.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setProject(defaults?.projectId ?? projects[0]?.id ?? "");
    setStatus(defaults?.status ?? "backlog");
    setPriority(0);
    setAssignee(null);
    setMilestoneId(null);
    setLabels([]);
    setError(null);
    setFieldErrors({});
    setCreated(null);
  }, [open]);

  useEffect(() => {
    if (!open || !project) return;
    let stale = false;
    setMilestoneId(null);
    setLabels([]);
    setOptions({ labels: [], milestones: [] });
    setOptionsError(null);
    loadCreateIssueOptions(project)
      .then((res) => {
        if (stale) return;
        if (res.ok) setOptions(res.data);
        else setOptionsError(res.error);
      })
      .catch(() => {
        if (!stale) setOptionsError("Something went wrong.");
      });
    return () => {
      stale = true;
    };
  }, [open, project]);

  const values = (): CreateIssueValues => ({ title, description, project, status, priority, assignee, milestoneId, labels });

  function submit() {
    if (pending || created) return;
    startTransition(async () => {
      setError(null);
      setFieldErrors({});
      const res = await createIssueAction(values()).catch(() => null);
      if (!res) {
        setError("Something went wrong. Check whether the issue was created before retrying.");
      } else if (res.ok) {
        setCreated(res.data);
        onCreated?.(res.data.identifier);
      } else {
        setError(res.error);
        setFieldErrors(res.fieldErrors);
      }
    });
  }

  const err = (field: string) => fieldErrors[field];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-xl"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      >
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="text-sm font-medium">New issue</DialogTitle>
          <DialogDescription className="sr-only">Create an issue</DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-3 px-4 py-6 text-[13px]" role="status">
            <p>
              Created <Link href={`/issues/${created.identifier}`} className="font-mono font-medium underline underline-offset-2" onClick={() => onOpenChange(false)}>{created.identifier}</Link>.
            </p>
            {created.labelError ? <p className="text-destructive">The issue exists, but its labels were not applied: {created.labelError}</p> : null}
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
              <Button size="sm" variant="outline" onClick={() => { setCreated(null); setTitle(""); setDescription(""); setLabels([]); }}>Create another</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2 px-4 pb-3 pt-2">
              <Input
                autoFocus
                aria-label="Title"
                aria-invalid={err("title") ? true : undefined}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Issue title"
                className="h-9 border-0 px-0 text-base font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
              {err("title") ? <p className="text-xs text-destructive">Title {err("title")}</p> : null}
              <Textarea
                aria-label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add description… (markdown)"
                className="min-h-20 resize-none border-0 px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-t px-4 py-2.5">
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger size="sm" aria-label="Project" className="h-7 gap-1.5 text-xs"><SelectValue placeholder="Project" /></SelectTrigger>
                <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={status} onValueChange={(v) => setStatus(v as IssueStatus)}>
                <SelectTrigger size="sm" aria-label="Status" className="h-7 gap-1.5 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{ISSUE_STATUSES.map((s) => <SelectItem key={s} value={s}><StatusIcon status={s} />{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={String(priority)} onValueChange={(v) => setPriority(Number(v) as Priority)}>
                <SelectTrigger size="sm" aria-label="Priority" className="h-7 gap-1.5 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={String(p)}>{PRIORITY_LABEL[p]}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={assignee ?? NONE} onValueChange={(v) => setAssignee(v === NONE ? null : (v as Actor))}>
                <SelectTrigger size="sm" aria-label="Assignee" className="h-7 gap-1.5 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}><ActorAvatar who={null} size={14} />Unassigned</SelectItem>
                  <SelectItem value="you"><ActorAvatar who="you" size={14} />You</SelectItem>
                  <SelectItem value="agent"><ActorAvatar who="agent" size={14} />Agent</SelectItem>
                </SelectContent>
              </Select>
              <Select value={milestoneId ?? NONE} onValueChange={(v) => setMilestoneId(v === NONE ? null : v)}>
                <SelectTrigger size="sm" aria-label="Milestone" className="h-7 gap-1.5 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No milestone</SelectItem>
                  {options.milestones.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {err("project") || err("milestoneId") || err("status") || err("priority") || err("assignee") ? (
              <p className="px-4 pb-2 text-xs text-destructive">
                {[err("project") && `Project ${err("project")}`, err("milestoneId") && `Milestone ${err("milestoneId")}`, err("status") && `Status ${err("status")}`, err("priority") && `Priority ${err("priority")}`, err("assignee") && `Assignee ${err("assignee")}`].filter(Boolean).join(". ")}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1.5 border-t px-4 py-2.5" aria-label="Labels">
              {optionsError ? <span className="text-xs text-destructive">Could not load labels: {optionsError}</span> : null}
              {!optionsError && options.labels.length === 0 ? <span className="text-xs text-muted-foreground">No labels yet. Create them on a project page.</span> : null}
              {options.labels.map((l) => {
                const on = labels.includes(l.name);
                return (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setLabels((s) => (on ? s.filter((x) => x !== l.name) : [...s, l.name]))}
                    className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] transition-colors", on ? "border-primary/50 bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent")}
                  >
                    <span className="size-1.5 rounded-full" style={{ background: l.color }} />
                    {l.name}
                  </button>
                );
              })}
            </div>
            {error ? <p role="alert" className="border-t px-4 py-2 text-xs text-destructive">{error}{err("labels") ? ` (labels: ${err("labels")})` : ""}</p> : null}
            <div className="flex items-center justify-between border-t px-4 py-3">
              <span className="text-xs text-muted-foreground"><Kbd>⌘</Kbd> + <Kbd>Enter</Kbd> to create</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button size="sm" onClick={submit} disabled={pending || !project}>{pending ? "Creating…" : "Create issue"}</Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
