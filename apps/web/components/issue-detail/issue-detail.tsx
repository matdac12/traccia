"use client";

import { AlertTriangle, ChevronRight, GitBranch, Link2, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteIssueAction, restoreIssueAction, updateIssueAction } from "@/app/(app)/issues/[identifier]/actions";
import { AgentMark } from "@/components/traccia/atoms";
import { LiveStatus } from "@/components/traccia/live-status";
import { Button } from "@/components/ui/button";
import { getJson } from "@/lib/polling/fetch-json";
import { usePoll } from "@/lib/polling/use-poll";
import { useMediaQuery } from "@/lib/use-media-query";
import type { IssueDetail as IssueDetailData, IssueRef, Label, Milestone } from "@/lib/api/schemas";
import { TimeAgo } from "./atoms";
import { Attachments } from "./attachments";
import { ActivityTimeline } from "./activity";
import { Comments } from "./comments";
import { Description } from "./description";
import { type Change, Properties } from "./properties";
import { BlockerList, SubIssues } from "./relations";

type Build = (current: IssueDetailData) => Record<string, unknown>;
/** Returns a reason to refuse a re-apply (the same field was also changed upstream), else null. */
type Guard = (current: IssueDetailData) => string | null;
type Conflict = { label: string; build: Build; guard?: Guard };
type Project = { id: string; key: string; name: string };

export type IssueDetailProps = {
  issue: IssueDetailData;
  projects: Project[];
  labels: Label[];
  milestones: Milestone[];
  parent: IssueRef | null;
};

export function IssueDetail(props: IssueDetailProps) {
  // The server's copy is the source of truth; a fresh render replaces whatever the client holds.
  const [seen, setSeen] = useState(props);
  const [issue, setIssue] = useState(props.issue);
  if (seen !== props) {
    setSeen(props);
    setIssue(props.issue);
  }
  const { projects, labels, milestones, parent } = props;

  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<Partial<IssueDetailData>>({});
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inFlight = useRef(false);
  const issueRef = useRef(issue);
  issueRef.current = issue;

  // Live refresh (MAT-1726). Fields the user may be editing (title, description, a save in flight) are never
  // overwritten: a newer server copy waits in `stale` behind an "updated, reload" banner. Comments, activity
  // and attachments cannot clash with a draft, so they always update.
  const dirty = useRef(new Set<string>());
  const setDirty = useCallback((key: string, on: boolean) => { if (on) dirty.current.add(key); else dirty.current.delete(key); }, []);
  const [stale, setStale] = useState<IssueDetailData | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const sync = usePoll(async () => {
    const remote = await getJson<IssueDetailData>(`/api/issues/${encodeURIComponent(issueRef.current.identifier)}`);
    const cur = issueRef.current;
    if (JSON.stringify(remote) === JSON.stringify(cur)) return setStale(null);
    if (dirty.current.size === 0 && !inFlight.current) {
      setIssue(remote);
      return setStale(null);
    }
    const timeline = { comments: remote.comments, activity: remote.activity, attachments: remote.attachments };
    if (JSON.stringify(timeline) !== JSON.stringify({ comments: cur.comments, activity: cur.activity, attachments: cur.attachments })) setIssue((c) => ({ ...c, ...timeline }));
    setStale(remote.updatedAt !== cur.updatedAt ? remote : null);
  }, { enabled: !deleted });
  const reload = () => {
    if (!stale) return;
    dirty.current.clear();
    setIssue(stale);
    setStale(null);
    setResetKey((k) => k + 1);
  };
  const staleBy = stale && [...stale.activity].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]?.actor;
  useEffect(() => { if (stale && stale.updatedAt === issue.updatedAt) setStale(null); }, [stale, issue.updatedAt]);

  const view = { ...issue, ...optimistic };
  const project = projects.find((p) => p.id === issue.projectId);

  /**
   * Sends one change. `build` computes the patch from the issue as it is NOW, which is what makes
   * "re-apply" safe after a conflict: a label toggle or blocker add is recomputed against the
   * agent's version instead of overwriting its set. Resolves true when saved.
   */
  const commit = async (label: string, build: Build, optimisticPatch: Partial<IssueDetailData> = {}, guard?: Guard): Promise<boolean> => {
    if (inFlight.current) return false;
    const base = issueRef.current;
    const refusal = guard?.(base);
    if (refusal) {
      // Free-text fields are not merged: if the agent edited the same field, the user decides.
      setConflict(null);
      setError(refusal);
      return false;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setOptimistic(optimisticPatch);
    const res = await updateIssueAction(base.identifier, build(base), base.updatedAt);
    setOptimistic({});
    setBusy(false);
    inFlight.current = false;
    if (res.ok) {
      setConflict(null);
      setIssue((cur) => ({ ...cur, ...res.issue, relations: cur.relations, children: cur.children }));
      return true;
    }
    if (res.code === "conflict") {
      setConflict({ label, build, guard });
      if (res.current) setIssue(res.current);
    } else setError(res.message);
    return false;
  };

  const change: Change = (label, build, optimisticPatch) => void commit(label, build, optimisticPatch);

  // The field as the user saw it when they started editing; a re-apply is refused if it moved since.
  const sameAs = (field: "title" | "description", noun: string): Guard => {
    const original = issue[field];
    return (cur) => (cur[field] !== original ? `The ${noun} was also changed by someone else, so your edit was not re-applied. Copy your text, then edit the latest version.` : null);
  };

  const refs = (list: IssueRef[]) => list.map((r) => r.identifier);
  const lookups = useMemo(
    () => ({
      milestone: (id: string) => milestones.find((m) => m.id === id)?.name,
      project: (id: string) => projects.find((p) => p.id === id)?.name,
    }),
    [milestones, projects],
  );

  // A hook must run on every render, so this sits above the `deleted` early return (below it, deleting crashed the page).
  // Properties sit in a side panel from lg up and inline under the title below it; mount only one copy.
  const wide = useMediaQuery("(min-width: 1024px)", true);

  if (deleted) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div role="status" className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-[13px] shadow-sm">
          <Trash2 className="size-4 text-muted-foreground" />
          <span><span className="font-mono text-xs">{issue.identifier}</span> moved to Trash.</span>
          <Button size="sm" variant="outline" disabled={busy} className="h-7 gap-1.5" onClick={async () => {
            setBusy(true);
            const res = await restoreIssueAction(issue.identifier);
            setBusy(false);
            if (res.ok) setDeleted(false);
            else setError(res.message);
          }}><Undo2 className="size-3.5" />Undo</Button>
          <Link href="/issues" className="text-muted-foreground hover:text-foreground">Back to issues</Link>
          {error && <span role="alert" className="text-destructive">{error}</span>}
        </div>
      </div>
    );
  }

  const propertiesPanel = <Properties issue={view} projects={projects} labels={labels} milestones={milestones} parent={parent} onChange={change} disabled={busy} />;

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1 text-[13px] sm:px-4">
        <Link href="/issues" className="text-muted-foreground hover:text-foreground">Issues</Link>
        <ChevronRight className="size-3.5 text-muted-foreground" />
        <Link href={`/projects/${issue.projectId}`} className="text-muted-foreground hover:text-foreground">{project?.name ?? issue.key}</Link>
        <ChevronRight className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-xs">{issue.identifier}</span>
        <div className="ml-auto flex items-center gap-1">
          <LiveStatus lastUpdated={sync.lastUpdated} failures={sync.failures} onRefresh={sync.refresh} />
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[13px] text-muted-foreground" onClick={() => navigator.clipboard?.writeText(issue.identifier)}><Link2 className="size-3.5" />Copy ID</Button>
          {confirmDelete ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              Move to Trash?
              <Button size="sm" variant="destructive" className="h-7" disabled={busy} onClick={async () => {
                setBusy(true);
                const res = await deleteIssueAction(issue.identifier);
                setBusy(false);
                setConfirmDelete(false);
                if (res.ok) setDeleted(true);
                else setError(res.message);
              }}>Delete</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </span>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[13px] text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)}><Trash2 className="size-3.5" />Delete</Button>
          )}
        </div>
      </header>

      {stale && (
        <div role="alert" data-testid="stale-banner" className="flex items-start gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="flex-1">
            <span className="font-medium">{issue.identifier} was updated{staleBy === "agent" ? " by an agent" : " elsewhere"}</span> while you were editing. Your edit is untouched; reload to see the latest version (this discards it).
          </p>
          <Button size="sm" className="h-7" onClick={reload}>Reload</Button>
        </div>
      )}

      {(conflict || error) && (
        <div role="alert" className="flex items-start gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          {conflict ? (
            <>
              <p className="flex-1">
                <span className="font-medium">{issue.identifier} was changed by someone else</span> after you opened it, so your change ({conflict.label}) was <span className="font-medium">not saved</span>. The page now shows the latest version.
              </p>
              <Button size="sm" className="h-7" disabled={busy} onClick={() => commit(conflict.label, conflict.build, {}, conflict.guard)}>Re-apply my change</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setConflict(null)}>Dismiss</Button>
            </>
          ) : (
            <>
              <p className="flex-1">{error}</p>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setError(null)}>Dismiss</Button>
            </>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[720px] px-4 py-5 sm:px-8 sm:py-8">
            {parent && (
              <Link href={`/issues/${parent.identifier}`} className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <GitBranch className="size-3" />{parent.identifier} {parent.title}
              </Link>
            )}
            <Title key={`${resetKey}:${issue.updatedAt}:${issue.title}`} onDirty={setDirty} value={view.title} disabled={busy} onSave={(title) => commit("title", () => ({ title }), { title }, sameAs("title", "title"))} />
            {issue.createdBy === "agent" && (
              <div className="mt-2"><AgentMark /> <span className="text-xs text-muted-foreground">created by an agent <TimeAgo iso={issue.createdAt} suffix=" ago" /></span></div>
            )}

            {!wide && (
              <section aria-label="Properties" className="mt-4 rounded-lg border bg-surface p-3">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Properties</div>
                {propertiesPanel}
              </section>
            )}

            <div className="mt-5">
              <Description key={resetKey} onDirty={setDirty} value={view.description} onSave={(description) => commit("description", () => ({ description }), {}, sameAs("description", "description"))} />
            </div>

            <Attachments identifier={issue.identifier} attachments={issue.attachments} />

            <SubIssues parentIdentifier={issue.identifier} items={issue.children} />

            <BlockerList
              title="Blocked by"
              issues={issue.relations.blockedBy}
              disabled={busy}
              exclude={[issue.identifier, ...refs(issue.relations.blockedBy)]}
              onAdd={(r) => change(`blocked by ${r.identifier}`, (cur) => ({ blockedBy: [...new Set([...refs(cur.relations.blockedBy), r.identifier])] }))}
              onRemove={(r) => change(`remove blocker ${r.identifier}`, (cur) => ({ blockedBy: refs(cur.relations.blockedBy).filter((x) => x !== r.identifier) }))}
            />
            <BlockerList
              title="Blocks"
              issues={issue.relations.blocks}
              disabled={busy}
              exclude={[issue.identifier, ...refs(issue.relations.blocks)]}
              onAdd={(r) => change(`blocks ${r.identifier}`, (cur) => ({ blocks: [...new Set([...refs(cur.relations.blocks), r.identifier])] }))}
              onRemove={(r) => change(`stop blocking ${r.identifier}`, (cur) => ({ blocks: refs(cur.relations.blocks).filter((x) => x !== r.identifier) }))}
            />

            <section className="mt-10" aria-label="Activity">
              <h3 className="mb-3 text-[13px] font-medium">Activity</h3>
              <ActivityTimeline rows={issue.activity} lookups={lookups} />
              <div className="mt-6">
                <Comments identifier={issue.identifier} comments={issue.comments} />
              </div>
            </section>
          </div>
        </div>

        {wide && (
          <aside className="w-[280px] shrink-0 overflow-y-auto border-l bg-surface p-4">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Properties</div>
            {propertiesPanel}
          </aside>
        )}
      </div>
    </div>
  );
}

function Title({ value, onSave, onDirty, disabled }: { value: string; onDirty: (key: string, on: boolean) => void; onSave: (title: string) => Promise<boolean>; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  const edited = draft !== value;
  useEffect(() => { onDirty("title", edited); return () => onDirty("title", false); }, [edited, onDirty]);
  const save = async () => {
    const next = draft.trim();
    if (!next || next === value) {
      setDraft(value);
      return;
    }
    // On a conflict the draft stays in the box; the banner offers to re-apply it.
    await onSave(next);
  };
  return (
    <textarea
      rows={1}
      aria-label="Title"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") setDraft(value);
      }}
      className="field-sizing-content w-full resize-none bg-transparent text-[22px] font-semibold leading-snug tracking-tight outline-none"
    />
  );
}
