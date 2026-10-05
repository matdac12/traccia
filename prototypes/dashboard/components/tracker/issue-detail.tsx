"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight, FileText, GitBranch, ImageIcon, Link2, Paperclip, Pencil, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LABELS, MILESTONES, PRIORITIES, PROJECTS, STATUSES, type Actor, type Priority, type Status, timeAgo } from "@/lib/mock-data";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AgentMark, Assignee, LabelChip, PriorityIcon, StatusIcon } from "./atoms";

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex min-h-8 items-center gap-2"><span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span><div className="min-w-0 flex-1">{children}</div></div>;
}
const trig = "h-7 w-full justify-start gap-2 border-transparent bg-transparent px-2 text-[13px] shadow-none hover:bg-accent dark:bg-transparent dark:hover:bg-accent [&>svg:last-child]:hidden";

export function IssueDetail({ id }: { id: string }) {
  const { issues, update, addComment, softDelete } = useStore();
  const router = useRouter();
  const issue = issues.find((i) => i.identifier === id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [comment, setComment] = useState("");
  const [drag, setDrag] = useState(false);
  if (!issue) return <div className="grid h-full place-items-center text-sm text-muted-foreground">Issue not found. <Link className="ml-1 text-primary" href="/issues">Back to issues</Link></div>;

  const project = PROJECTS.find((p) => p.key === issue.projectKey)!;
  const subs = issues.filter((i) => i.parent === issue.identifier);
  const parent = issues.find((i) => i.identifier === issue.parent);
  const blockers = issue.blockedBy.map((b) => issues.find((i) => i.identifier === b)).filter(Boolean) as typeof issues;
  const merged = [
    ...issue.activity.map((a) => ({ kind: "act" as const, at: a.at, actor: a.actor, text: a.text, id: a.id })),
  ].sort((a, b) => +new Date(a.at) - +new Date(b.at));

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b px-4 text-[13px]">
        <Link href="/issues" className="text-muted-foreground hover:text-foreground">Issues</Link><ChevronRight className="size-3.5 text-muted-foreground" />
        <Link href={`/projects/${project.key}`} className="text-muted-foreground hover:text-foreground">{project.name}</Link><ChevronRight className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-xs">{issue.identifier}</span>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[13px] text-muted-foreground" onClick={() => navigator.clipboard?.writeText(issue.identifier)}><Link2 className="size-3.5" />Copy ID</Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[13px] text-muted-foreground hover:text-destructive" onClick={() => { softDelete(issue.identifier); router.push("/issues"); }}><Trash2 className="size-3.5" />Delete</Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[720px] px-8 py-8">
            {parent && <Link href={`/issues/${parent.identifier}`} className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><GitBranch className="size-3" />{parent.identifier} {parent.title}</Link>}
            <textarea rows={1} value={issue.title} onChange={(e) => update(issue.identifier, { title: e.target.value })} className="field-sizing-content w-full resize-none bg-transparent text-[22px] font-semibold leading-snug tracking-tight outline-none" />
            {issue.createdBy === "agent" && <div className="mt-2"><AgentMark /> <span className="text-xs text-muted-foreground">created by an agent {timeAgo(issue.activity[0]?.at ?? issue.updatedAt)} ago</span></div>}

            <div className="group mt-5">
              {editing ? (
                <div className="space-y-2">
                  <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-40 font-mono text-[13px]" autoFocus />
                  <div className="rounded-md border bg-surface p-3"><div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Preview</div><div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown></div></div>
                  <div className="flex gap-2"><Button size="sm" onClick={() => { update(issue.identifier, { description: draft }, "edited the description"); setEditing(false); }}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
                </div>
              ) : (
                <div className="relative rounded-md">
                  <Button variant="ghost" size="sm" className="absolute -right-1 -top-1 h-6 gap-1 text-xs text-muted-foreground opacity-0 group-hover:opacity-100" onClick={() => { setDraft(issue.description); setEditing(true); }}><Pencil className="size-3" />Edit</Button>
                  {issue.description ? <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{issue.description}</ReactMarkdown></div> : <button className="text-sm text-muted-foreground" onClick={() => { setDraft(""); setEditing(true); }}>Add description…</button>}
                </div>
              )}
            </div>

            {/* Attachments slot (MAT-1725) */}
            <section className="mt-8">
              <h3 className="mb-2 flex items-center gap-2 text-[13px] font-medium"><Paperclip className="size-3.5 text-muted-foreground" />Attachments <span className="text-xs font-normal text-muted-foreground">{issue.attachments.length}</span></h3>
              <div className="flex flex-wrap gap-2">
                {issue.attachments.map((a) => (
                  <div key={a.id} className="flex w-44 items-center gap-2 rounded-lg border bg-card p-2">
                    <div className="grid size-9 place-items-center rounded-md bg-muted text-muted-foreground">{a.kind === "image" ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}</div>
                    <div className="min-w-0"><div className="truncate text-xs">{a.name}</div><div className="text-[11px] text-muted-foreground">{a.size}</div></div>
                  </div>
                ))}
                <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); }}
                  className={cn("flex h-[54px] w-44 items-center justify-center gap-2 rounded-lg border border-dashed text-xs text-muted-foreground transition-colors", drag && "border-primary bg-primary/5 text-primary")}>
                  <Upload className="size-3.5" />Drop files to attach
                </div>
              </div>
            </section>

            <section className="mt-8">
              <h3 className="mb-2 text-[13px] font-medium">Sub-issues <span className="text-xs font-normal text-muted-foreground">{subs.filter((s) => s.status === "done").length}/{subs.length}</span></h3>
              {subs.length === 0 ? <p className="text-xs text-muted-foreground">No sub-issues.</p> : <div className="overflow-hidden rounded-lg border">{subs.map((s) => (
                <Link key={s.identifier} href={`/issues/${s.identifier}`} className="flex h-9 items-center gap-2 border-b px-3 text-[13px] last:border-0 hover:bg-accent/50"><StatusIcon status={s.status} /><span className="font-mono text-xs text-muted-foreground">{s.identifier}</span><span className="truncate">{s.title}</span><span className="ml-auto"><Assignee who={s.assignee} /></span></Link>
              ))}</div>}
            </section>

            {blockers.length > 0 && (
              <section className="mt-6">
                <h3 className="mb-2 text-[13px] font-medium">Blocked by</h3>
                <div className="overflow-hidden rounded-lg border">{blockers.map((s) => (
                  <Link key={s.identifier} href={`/issues/${s.identifier}`} className="flex h-9 items-center gap-2 border-b px-3 text-[13px] last:border-0 hover:bg-accent/50"><StatusIcon status={s.status} /><span className="font-mono text-xs text-muted-foreground">{s.identifier}</span><span className="truncate">{s.title}</span></Link>
                ))}</div>
              </section>
            )}

            <section className="mt-10">
              <h3 className="mb-3 text-[13px] font-medium">Activity</h3>
              <ol className="relative space-y-3 border-l pl-5">
                {merged.map((m) => (
                  <li key={m.id} className="relative text-[13px] text-muted-foreground">
                    <span className="absolute -left-[25px] top-1.5 size-1.5 rounded-full bg-border ring-4 ring-background" />
                    <span className="inline-flex items-center gap-1.5"><Assignee who={m.actor} size={14} /><span className="text-foreground">{m.actor === "agent" ? "claude-code-mac" : "You"}</span> {m.text}<span className="text-xs">· {timeAgo(m.at)}</span></span>
                  </li>
                ))}
              </ol>
              <div className="mt-6 space-y-4">
                {issue.comments.map((c) => (
                  <div key={c.id} className={cn("rounded-lg border p-3", c.author === "agent" && "border-agent/25 bg-agent/5")}>
                    <div className="mb-1 flex items-center gap-2 text-xs"><Assignee who={c.author} size={16} /><span className="font-medium">{c.author === "agent" ? c.actorName ?? "agent" : "You"}</span>{c.author === "agent" && <AgentMark />}<span className="text-muted-foreground">{timeAgo(c.at)} ago</span></div>
                    <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown></div>
                  </div>
                ))}
                <div className="rounded-lg border p-2">
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Leave a comment…" className="min-h-16 resize-none border-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent" />
                  <div className="flex justify-end"><Button size="sm" disabled={!comment.trim()} onClick={() => { addComment(issue.identifier, comment.trim()); setComment(""); }}>Comment</Button></div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <aside className="hidden w-[280px] shrink-0 overflow-y-auto border-l bg-surface p-4 lg:block">
          <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Properties</div>
          <div className="space-y-0.5">
            <Prop label="Status"><Select value={issue.status} onValueChange={(v) => update(issue.identifier, { status: v as Status }, `changed status to ${STATUSES.find((s) => s.key === v)!.label}`)}><SelectTrigger className={trig}><SelectValue /></SelectTrigger><SelectContent>{STATUSES.map((s) => <SelectItem key={s.key} value={s.key}><StatusIcon status={s.key} />{s.label}</SelectItem>)}</SelectContent></Select></Prop>
            <Prop label="Priority"><Select value={String(issue.priority)} onValueChange={(v) => update(issue.identifier, { priority: Number(v) as Priority }, "changed priority")}><SelectTrigger className={trig}><SelectValue /></SelectTrigger><SelectContent>{PRIORITIES.map((p) => <SelectItem key={p.key} value={String(p.key)}><PriorityIcon priority={p.key} />{p.label}</SelectItem>)}</SelectContent></Select></Prop>
            <Prop label="Assignee"><Select value={issue.assignee ?? "none"} onValueChange={(v) => update(issue.identifier, { assignee: v === "none" ? null : (v as Actor) }, "changed assignee")}><SelectTrigger className={trig}><Assignee who={issue.assignee} /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem><SelectItem value="you">You</SelectItem><SelectItem value="agent">Agent</SelectItem></SelectContent></Select></Prop>
            <Prop label="Estimate"><Select value={String(issue.estimate ?? "none")} onValueChange={(v) => update(issue.identifier, { estimate: v === "none" ? null : Number(v) }, "changed estimate")}><SelectTrigger className={trig}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No estimate</SelectItem>{[1, 2, 3, 5, 8, 13].map((n) => <SelectItem key={n} value={String(n)}>{n} points</SelectItem>)}</SelectContent></Select></Prop>
            <Prop label="Labels">
              <DropdownMenu><DropdownMenuTrigger asChild><button className="flex min-h-7 w-full flex-wrap items-center gap-1 rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent">{issue.labels.length ? issue.labels.map((l) => <LabelChip key={l} name={l} />) : <span className="text-muted-foreground">Add labels</span>}</button></DropdownMenuTrigger>
                <DropdownMenuContent align="start">{LABELS.map((l) => <DropdownMenuItem key={l.name} onSelect={(e) => { e.preventDefault(); update(issue.identifier, { labels: issue.labels.includes(l.name) ? issue.labels.filter((x) => x !== l.name) : [...issue.labels, l.name] }, "changed labels"); }}><span className="size-2 rounded-full" style={{ background: l.color }} />{l.name}{issue.labels.includes(l.name) && <span className="ml-auto text-primary">✓</span>}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
            </Prop>
            <div className="my-3 border-t" />
            <Prop label="Project"><Link href={`/projects/${project.key}`} className="flex h-7 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-accent"><span className="size-2.5 rounded-[3px]" style={{ background: project.color }} />{project.name}</Link></Prop>
            <Prop label="Milestone"><Select value={issue.milestoneId ?? "none"} onValueChange={(v) => update(issue.identifier, { milestoneId: v === "none" ? null : v }, "changed milestone")}><SelectTrigger className={trig}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No milestone</SelectItem>{MILESTONES.filter((m) => m.projectKey === issue.projectKey).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select></Prop>
            <Prop label="Updated"><span className="px-2 text-[13px] text-muted-foreground">{timeAgo(issue.updatedAt)} ago</span></Prop>
          </div>
        </aside>
      </div>
    </div>
  );
}
