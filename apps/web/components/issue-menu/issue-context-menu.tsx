"use client";
import { Check, CornerDownRight, ExternalLink, Link2, ListTree, MoreHorizontal, Copy, Trash2 } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { createSubIssueAction } from "@/app/(app)/issues/[identifier]/actions";
import { IssuePicker } from "@/components/issue-detail/issue-picker";
import { assigneeOptions, labelOptions, priorityOptions, statusOptions, type InlineEditor, type PickOption } from "@/components/inline-edit/options";
import { Button } from "@/components/ui/button";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { IssueRow, Milestone, Project } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

/** What the menu needs besides the issue: the lists for the Project and Milestone submenus, and the delete handler. */
export type IssueMenuContext = { editor: InlineEditor; projects: Pick<Project, "id" | "key" | "name">[]; milestones: Milestone[]; onDelete: (issue: IssueRow) => void };

const Tick = ({ on }: { on: boolean }) => (on ? <Check className="ml-auto size-3.5 text-primary" /> : null);

/** A portaled menu or dialog still bubbles React events to the card, where they would start a drag. */
const stop = { onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(), onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };

function Choices({ options }: { options: PickOption[] }) {
  return options.map((o) => (
    <ContextMenuItem key={o.key} onSelect={(e) => { if (o.keepOpen) e.preventDefault(); o.onSelect(e); }}>
      {o.icon}{o.text}<Tick on={o.checked} />
    </ContextMenuItem>
  ));
}

function Sub({ icon, text, children }: { icon: ReactNode; text: string; children: ReactNode }) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{icon}{text}</ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 overflow-y-auto" {...stop}>{children}</ContextMenuSubContent>
    </ContextMenuSub>
  );
}

const issueUrl = (identifier: string) => `/issues/${identifier}`;
const copy = (text: string) => void navigator.clipboard?.writeText(text);

type Dialogs = "parent" | "sub" | null;

/**
 * Right-click menu of an issue row or card (MAT-1762). Wrap the row (or card) element: it becomes the trigger, so
 * right-click, long press on touch and Shift+F10 / the context-menu key on a focused child all open it. Every
 * change goes through `editor.edit` (optimistic, `If-Match`, conflict notice), same as the inline pickers.
 */
export function IssueContextMenu({ issue, menu, children }: { issue: IssueRow; menu: IssueMenuContext; children: ReactNode }) {
  const { editor, projects, milestones, onDelete } = menu;
  const [dialog, setDialog] = useState<Dialogs>(null);
  const milestoneChoices = milestones.filter((m) => m.projectId === issue.projectId);
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-56" aria-label={`Actions for ${issue.identifier}`} {...stop}>
          <Sub icon={null} text="Status"><Choices options={statusOptions(issue, editor)} /></Sub>
          <Sub icon={null} text="Priority"><Choices options={priorityOptions(issue, editor)} /></Sub>
          <Sub icon={null} text="Assignee"><Choices options={assigneeOptions(issue, editor)} /></Sub>
          <Sub icon={null} text="Labels">
            {labelOptions(issue, editor).length === 0 ? <div className="px-2 py-1.5 text-xs text-muted-foreground">No labels yet.</div> : <Choices options={labelOptions(issue, editor)} />}
          </Sub>
          <Sub icon={null} text="Project">
            {projects.map((p) => (
              <ContextMenuItem key={p.id} onSelect={() => p.id !== issue.projectId && editor.edit(issue, `project to ${p.name}`, () => ({ project: p.key }), { projectId: p.id, parentId: null, milestoneId: null })}>
                {p.name}<Tick on={p.id === issue.projectId} />
              </ContextMenuItem>
            ))}
            <div className="max-w-56 px-2 py-1 text-[11px] text-muted-foreground">Moving clears the parent and milestone, and takes sub-issues along.</div>
          </Sub>
          <Sub icon={null} text="Milestone">
            <ContextMenuItem onSelect={() => issue.milestoneId && editor.edit(issue, "milestone", () => ({ milestoneId: null }), { milestoneId: null })}>No milestone<Tick on={!issue.milestoneId} /></ContextMenuItem>
            {milestoneChoices.map((m) => (
              <ContextMenuItem key={m.id} onSelect={() => m.id !== issue.milestoneId && editor.edit(issue, `milestone to ${m.name}`, () => ({ milestoneId: m.id }), { milestoneId: m.id })}>{m.name}<Tick on={m.id === issue.milestoneId} /></ContextMenuItem>
            ))}
          </Sub>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => setDialog("parent")}><CornerDownRight />Set parent…</ContextMenuItem>
          {issue.parentId && <ContextMenuItem onSelect={() => editor.edit(issue, "parent", () => ({ parentId: null }), { parentId: null })}>Remove parent</ContextMenuItem>}
          <ContextMenuItem onSelect={() => setDialog("sub")}><ListTree />Add sub-issue…</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => copy(issue.identifier)}><Copy />Copy identifier</ContextMenuItem>
          <ContextMenuItem onSelect={() => copy(`${window.location.origin}${issueUrl(issue.identifier)}`)}><Link2 />Copy link</ContextMenuItem>
          <ContextMenuItem onSelect={() => window.open(issueUrl(issue.identifier), "_blank", "noopener")}><ExternalLink />Open in new tab</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => onDelete(issue)}><Trash2 />Delete</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <span {...stop}>
        <ParentDialog issue={issue} editor={editor} open={dialog === "parent"} onClose={() => setDialog(null)} />
        <SubIssueDialog issue={issue} open={dialog === "sub"} onClose={() => setDialog(null)} />
      </span>
    </>
  );
}

function ParentDialog({ issue, editor, open, onClose }: { issue: IssueRow; editor: InlineEditor; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set parent of {issue.identifier}</DialogTitle>
          <DialogDescription>Pick the issue this one becomes a sub-issue of.</DialogDescription>
        </DialogHeader>
        <IssuePicker autoFocus exclude={[issue.identifier]} placeholder="Parent identifier or title…" onPick={(p) => { onClose(); editor.edit(issue, `parent to ${p.identifier}`, () => ({ parentId: p.id })); }} />
      </DialogContent>
    </Dialog>
  );
}

function SubIssueDialog({ issue, open, onClose }: { issue: IssueRow; open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = useRef(onClose);
  done.current = onClose;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await createSubIssueAction(issue.identifier, title);
      if (res.ok) { setTitle(""); done.current(); } else setError(res.message);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setError(null); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add sub-issue to {issue.identifier}</DialogTitle>
          <DialogDescription>It is created in the same project and shows up in the list within a few seconds.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Input autoFocus aria-label="Sub-issue title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" className="self-end" disabled={busy || !title.trim()}>Create sub-issue</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The "..." button for touch and keyboard users. It asks the enclosing `IssueContextMenu` to open by dispatching
 * a `contextmenu` event at the button, so there is one menu and one code path.
 */
export function IssueMenuButton({ issue, className }: { issue: IssueRow; className?: string }) {
  return (
    <span className={cn("relative z-[1] inline-flex", className)} onKeyDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={`Actions for ${issue.identifier}`}
        aria-haspopup="menu"
        className="inline-flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 outline-none hover:bg-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 data-[state=open]:opacity-100"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left, clientY: r.bottom }));
        }}
      >
        <MoreHorizontal className="size-4" />
      </button>
    </span>
  );
}
