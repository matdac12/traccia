"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CalendarDays, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { MILESTONES, PROJECTS, STATUSES } from "@/lib/mock-data";
import { useStore } from "@/lib/store";
import { StatusIcon } from "./atoms";
import { IssuesView } from "./issues-view";

const statusTone: Record<string, string> = { active: "text-[var(--st-review)]", paused: "text-[var(--st-progress)]", completed: "text-[var(--st-done)]", canceled: "text-muted-foreground" };

export function ProjectsOverview() {
  const { issues } = useStore();
  return (
    <div className="h-full overflow-y-auto">
      <header className="flex h-12 items-center border-b px-4"><h1 className="text-[13px] font-medium">Projects</h1></header>
      <div className="mx-auto max-w-4xl divide-y px-4">
        {PROJECTS.map((p) => {
          const own = issues.filter((i) => i.projectKey === p.key);
          const done = own.filter((i) => i.status === "done").length;
          return (
            <Link key={p.key} href={`/projects/${p.key}`} className="flex items-center gap-4 py-4 hover:bg-accent/30">
              <span className="size-3 rounded-[4px]" style={{ background: p.color }} />
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">{p.name} <span className="font-mono text-xs text-muted-foreground">{p.key}</span></div>
                <div className="mt-1 flex gap-3 text-xs text-muted-foreground">{STATUSES.map((s) => { const n = own.filter((i) => i.status === s.key).length; return n ? <span key={s.key} className="flex items-center gap-1"><StatusIcon status={s.key} />{n}</span> : null; })}</div></div>
              <Badge variant="outline" className={`capitalize ${statusTone[p.status]}`}>{p.status}</Badge>
              <div className="w-32"><Progress value={own.length ? (done / own.length) * 100 : 0} className="h-1" /><div className="mt-1 text-right text-[11px] text-muted-foreground">{done}/{own.length} done</div></div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function ProjectPage({ projectKey }: { projectKey: string }) {
  const { issues } = useStore();
  const project = PROJECTS.find((p) => p.key === projectKey);
  const [desc, setDesc] = useState(project?.description ?? "");
  const [editing, setEditing] = useState(false);
  if (!project) return <div className="grid h-full place-items-center text-sm text-muted-foreground">Project not found.</div>;
  const milestones = MILESTONES.filter((m) => m.projectKey === project.key);
  return (
    <div className="h-full overflow-y-auto">
      <header className="flex h-12 items-center gap-2 border-b px-4">
        <span className="size-2.5 rounded-[3px]" style={{ background: project.color }} />
        <h1 className="text-[13px] font-medium">{project.name}</h1>
        <Badge variant="outline" className={`capitalize ${statusTone[project.status]}`}>{project.status}</Badge>
      </header>
      <div className="grid gap-8 px-4 py-6 lg:grid-cols-[1fr_340px]">
        <section className="group relative">
          <Button variant="ghost" size="sm" className="absolute right-0 top-0 h-6 gap-1 text-xs text-muted-foreground opacity-0 group-hover:opacity-100" onClick={() => setEditing(!editing)}><Pencil className="size-3" />{editing ? "Done" : "Edit"}</Button>
          {editing ? <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} className="min-h-48 font-mono text-[13px]" /> : <div className="md max-w-2xl"><ReactMarkdown remarkPlugins={[remarkGfm]}>{desc}</ReactMarkdown></div>}
        </section>
        <section>
          <div className="mb-2 flex items-center"><h2 className="text-[13px] font-medium">Milestones</h2><Button variant="ghost" size="icon" className="ml-auto size-6"><Plus className="size-3.5" /></Button></div>
          <div className="space-y-2">
            {milestones.map((m) => {
              const own = issues.filter((i) => i.milestoneId === m.id);
              const done = own.filter((i) => i.status === "done").length;
              return (
                <div key={m.id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between text-[13px]"><span className="font-medium">{m.name}</span><span className="text-xs text-muted-foreground">{own.length ? Math.round((done / own.length) * 100) : 0}%</span></div>
                  <Progress value={own.length ? (done / own.length) * 100 : 0} className="mt-2 h-1" />
                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground"><span>{done}/{own.length} issues</span><span className="flex items-center gap-1"><CalendarDays className="size-3" />{m.target}</span></div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      <div className="h-[560px] border-t"><Suspense><IssuesView fixedProject={project.key} title="Issues" /></Suspense></div>
    </div>
  );
}
