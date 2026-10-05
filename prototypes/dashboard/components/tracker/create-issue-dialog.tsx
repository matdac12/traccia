"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LABELS, PRIORITIES, PROJECTS, STATUSES, type Actor, type Priority, type Status } from "@/lib/mock-data";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Assignee, PriorityIcon, StatusIcon } from "./atoms";

export function CreateIssueDialog({ open, onOpenChange, defaultProject, defaultStatus }: { open: boolean; onOpenChange: (o: boolean) => void; defaultProject?: string; defaultStatus?: Status }) {
  const { create } = useStore();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [project, setProject] = useState(defaultProject ?? "TRK");
  const [status, setStatus] = useState<Status>(defaultStatus ?? "backlog");
  const [assignee, setAssignee] = useState<Actor | "none">("none");
  const [priority, setPriority] = useState<Priority>(0);
  const [labels, setLabels] = useState<string[]>([]);

  const submit = () => {
    if (!title.trim()) return;
    const i = create({ title: title.trim(), projectKey: project, status, assignee: assignee === "none" ? null : assignee, priority, labels });
    setTitle(""); setLabels([]); onOpenChange(false);
    router.push(`/issues/${i.identifier}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(); }}>
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="text-sm font-medium">New issue</DialogTitle>
          <DialogDescription className="sr-only">Create an issue</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 px-4 pb-3 pt-2">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Issue title" className="h-9 border-0 px-0 text-base font-medium shadow-none focus-visible:ring-0 dark:bg-transparent" />
          <Textarea placeholder="Add description… (markdown)" className="min-h-20 resize-none border-0 px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t px-4 py-2.5">
          <Select value={project} onValueChange={setProject}>
            <SelectTrigger size="sm" className="h-7 gap-1.5 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{PROJECTS.map((p) => <SelectItem key={p.key} value={p.key}><span className="size-2 rounded-sm" style={{ background: p.color }} />{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
            <SelectTrigger size="sm" className="h-7 gap-1.5 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s.key} value={s.key}><StatusIcon status={s.key} />{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(priority)} onValueChange={(v) => setPriority(Number(v) as Priority)}>
            <SelectTrigger size="sm" className="h-7 gap-1.5 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p.key} value={String(p.key)}><PriorityIcon priority={p.key} />{p.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={assignee} onValueChange={(v) => setAssignee(v as Actor | "none")}>
            <SelectTrigger size="sm" className="h-7 gap-1.5 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none"><Assignee who={null} />Unassigned</SelectItem>
              <SelectItem value="you"><Assignee who="you" />You</SelectItem>
              <SelectItem value="agent"><Assignee who="agent" />Agent</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-1.5 border-t px-4 py-2.5">
          {LABELS.map((l) => {
            const on = labels.includes(l.name);
            return (
              <button key={l.name} type="button" onClick={() => setLabels((s) => (on ? s.filter((x) => x !== l.name) : [...s, l.name]))}
                className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] transition-colors", on ? "border-primary/50 bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent")}>
                <span className="size-1.5 rounded-full" style={{ background: l.color }} />{l.name}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t px-4 py-3">
          <span className="text-xs text-muted-foreground">⌘ + Enter to create</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={!title.trim()}>Create issue</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
