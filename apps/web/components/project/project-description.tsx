"use client";
import { ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { updateProjectDescriptionAction } from "@/app/(app)/projects/[id]/actions";
import { Markdown } from "@/components/issue-detail/markdown";
import { ConflictNotice } from "@/components/traccia/conflict-notice";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Collapsed height in px (about five lines of body text). It is both the clip height and the toggle threshold, so a clipped text always has a "Show more". */
export const COLLAPSED_HEIGHT = 120;

/** True when `contentHeight` is taller than the clip, i.e. exactly when the text would be cut off. */
export function overflowsCollapsed(contentHeight: number): boolean {
  return contentHeight > COLLAPSED_HEIGHT;
}

/**
 * Markdown description (same sanitised renderer as issue descriptions) with an inline editor. It is collapsed to a few
 * lines with a fade; the toggle only exists when the text really overflows, and sits over the fade so it adds no height.
 */
export function ProjectDescription({ projectId, description, updatedAt }: { projectId: string; description: string; updatedAt: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, start] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const bodyId = useId();

  // The content div is never clipped itself (its wrapper is), so its height is the full text height at any time.
  // Re-measured on resize and when images load, which change the height after first paint.
  useEffect(() => {
    const el = content.current;
    if (!el || editing) return;
    const measure = () => setOverflowing(overflowsCollapsed(el.offsetHeight));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [editing]);

  const save = () =>
    start(async () => {
      const res = await updateProjectDescriptionAction(projectId, draft, updatedAt);
      if (res.ok) {
        setError(null);
        setConflict(false);
        setEditing(false);
      } else {
        // On a conflict the editor stays open with the draft; Save again overwrites the latest version knowingly.
        setConflict(res.conflict === true);
        setError(res.conflict ? null : res.error);
      }
    });

  if (editing) {
    return (
      <section aria-label="Description" className="space-y-2">
        <Textarea aria-label="Description" value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-48 font-mono text-[13px]" autoFocus />
        {conflict ? <ConflictNotice what="This project"> Your draft is kept below; Save again to overwrite the latest version.</ConflictNotice> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setDraft(description); setError(null); setConflict(false); setEditing(false); }}>Cancel</Button>
        </div>
      </section>
    );
  }
  const collapsed = overflowing && !expanded;
  const toggle = (
    <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => setExpanded(!expanded)}>
      {collapsed ? <ChevronDown /> : <ChevronUp />}{collapsed ? "Show more" : "Show less"}
    </Button>
  );
  return (
    <section aria-label="Description">
      <div className="mb-1.5 flex h-6 items-center">
        <h2 className="text-[13px] font-medium">Description</h2>
        <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => { setDraft(description); setEditing(true); }}>
          <Pencil />Edit
        </Button>
      </div>
      {description.trim() ? (
        <div className="relative">
          {/* Clipped before hydration too (the style is static), so a long text never flashes at full height. */}
          <div id={bodyId} className="overflow-hidden" style={expanded ? undefined : { maxHeight: COLLAPSED_HEIGHT }}>
            <div ref={content} className="max-w-3xl"><Markdown>{description}</Markdown></div>
          </div>
          {collapsed ? (
            <div data-testid="description-fade" className="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end bg-gradient-to-t from-background from-40% to-transparent">
              <span className="pointer-events-auto">{toggle}</span>
            </div>
          ) : null}
          {overflowing && expanded ? <div className="mt-1">{toggle}</div> : null}
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">No description. Use Edit to add one.</p>
      )}
    </section>
  );
}
