"use client";
import {
  closestCorners, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ISSUE_STATUSES, type IssueStatus, type Priority } from "@traccia/shared";
import { Loader2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { loadMoreBoardIssues, moveBoardIssue } from "@/app/(app)/issues/board-actions";
import { countsOf, sameGroups, type GroupsApplier } from "@/components/issues-table/use-list-sync";
import { LabelChip } from "@/components/issues-table/label-chip";
import { PriorityIcon } from "@/components/issues-table/priority";
import { ActorAvatar, AgentMark, STATUS_LABEL, StatusIcon } from "@/components/traccia/atoms";
import { Button } from "@/components/ui/button";
import type { IssueRow } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";
import {
  applyServerIssue, findCard, moveCard, moveErrorMessage, planMove, type BoardColumn, type MoveRequest, type MoveResult,
} from "./board-model";

const VISIBLE_LABELS = 2;

export type BoardProps = {
  columns: BoardColumn[];
  /** The page's search string, so "load more" re-applies the same filters. */
  query: string;
  /** Injectable for tests; defaults to the server actions. */
  move?: (request: MoveRequest) => Promise<MoveResult>;
  /** Live refresh (MAT-1726): the poll registers here. */
  register?: (a: GroupsApplier | null) => void;
  loadMore?: (input: { query: string; status: IssueStatus; cursor: string }) => Promise<{ items: IssueRow[]; nextCursor: string | null }>;
};

export function Board({ columns: initial, query, move = moveBoardIssue, loadMore = loadMoreBoardIssues, register }: BoardProps) {
  const [columns, setColumns] = useState<BoardColumn[]>(initial);
  const [active, setActive] = useState<IssueRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  const [loading, setLoading] = useState<Set<IssueStatus>>(new Set());
  const [, startTransition] = useTransition();
  /** The columns as they were when the drag started: the rollback target. */
  const snapshot = useRef<BoardColumn[] | null>(null);
  /** Moves in flight; a new drag waits for them so a failed move can be undone on its own. */
  const inFlight = useRef(0);
  const current = useRef(columns);
  const commit = (next: BoardColumn[]) => { current.current = next; setColumns(next); };

  // A poll never touches the board while a drag or a move is in progress: it is refused and retried next tick.
  useEffect(() => {
    register?.({
      counts: () => countsOf(current.current),
      apply: (fresh) => {
        if (snapshot.current || inFlight.current > 0) return false;
        if (!sameGroups(current.current, fresh)) commit(fresh);
        return true;
      },
    });
    return () => register?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const statusOf = (id: string | number): IssueStatus | null =>
    (ISSUE_STATUSES as readonly string[]).includes(String(id)) ? (id as IssueStatus) : findCard(current.current, String(id))?.status ?? null;

  const onStart = (e: DragStartEvent) => {
    if (inFlight.current > 0) return;
    snapshot.current = current.current;
    setError(null);
    const at = findCard(current.current, String(e.active.id));
    setActive(at ? current.current.find((c) => c.status === at.status)!.items[at.index]! : null);
  };

  // Live cross-column move while hovering, so the card shows where it will land.
  const onOver = ({ active: a, over }: DragOverEvent) => {
    if (!over || !snapshot.current) return;
    const id = String(a.id);
    const to = statusOf(over.id);
    const from = findCard(current.current, id);
    if (!to || !from || from.status === to) return;
    const overCard = findCard(current.current, String(over.id));
    const items = current.current.find((c) => c.status === to)!.items;
    const index = overCard ? overCard.index + (a.rect.current.translated && over.rect && a.rect.current.translated.top > over.rect.top + over.rect.height / 2 ? 1 : 0) : items.length;
    commit(moveCard(current.current, id, to, index));
  };

  /** Puts one card back where it was in `before`, keeping anything loaded since. */
  const restore = (before: BoardColumn[], id: string) => {
    const was = findCard(before, id);
    if (was) commit(moveCard(current.current, id, was.status, was.index));
  };

  const onEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    const before = snapshot.current;
    snapshot.current = null;
    if (!before) return;
    const id = String(a.id);
    if (!over) return restore(before, id);
    const at = findCard(current.current, id);
    const overCard = findCard(current.current, String(over.id));
    // Same-column reorder is applied here; cross-column moves already happened in onOver.
    if (at && overCard && overCard.status === at.status && overCard.index !== at.index) commit(moveCard(current.current, id, at.status, overCard.index));
    const request = planMove(current.current, id);
    const was = findCard(before, id);
    const now = findCard(current.current, id);
    if (!request || !was || !now || (was.status === now.status && was.index === now.index)) return;

    const undo = () => restore(before, id);
    setSaving((n) => n + 1);
    inFlight.current++;
    startTransition(async () => {
      try {
        const result = await move(request);
        if (result.ok) commit(applyServerIssue(current.current, result.issue));
        else { undo(); setError(moveErrorMessage(request.identifier, result.code, result.message)); }
      } catch {
        undo();
        setError(moveErrorMessage(request.identifier, "unreachable", "network error"));
      } finally {
        inFlight.current--;
        setSaving((n) => n - 1);
      }
    });
  };

  const more = (column: BoardColumn) => {
    if (!column.nextCursor) return;
    const cursor = column.nextCursor;
    setLoading((l) => new Set(l).add(column.status));
    startTransition(async () => {
      try {
        const page = await loadMore({ query, status: column.status, cursor });
        commit(current.current.map((c) => {
          if (c.status !== column.status) return c;
          const known = new Set(c.items.map((i) => i.id));
          return { ...c, items: [...c.items, ...page.items.filter((i) => !known.has(i.id))], nextCursor: page.nextCursor };
        }));
      } catch {
        setError(`Could not load more ${STATUS_LABEL[column.status].toLowerCase()} issues.`);
      } finally {
        setLoading((l) => { const n = new Set(l); n.delete(column.status); return n; });
      }
    });
  };

  return (
    <div className="flex h-full flex-col" aria-busy={saving > 0}>
      {error && (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <span className="flex-1">{error}</span>
          <Button type="button" variant="ghost" size="icon" className="size-5" aria-label="Dismiss" onClick={() => setError(null)}><X className="size-3.5" /></Button>
        </div>
      )}
      <DndContext
        id="kanban"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onStart}
        onDragOver={onOver}
        onDragEnd={onEnd}
        onDragCancel={() => { if (snapshot.current && active) restore(snapshot.current, active.id); setActive(null); snapshot.current = null; }}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
          {columns.map((c) => <Column key={c.status} column={c} loading={loading.has(c.status)} onMore={() => more(c)} />)}
        </div>
        <DragOverlay>{active && <Card issue={active} overlay />}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({ column, loading, onMore }: { column: BoardColumn; loading: boolean; onMore: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });
  return (
    <section aria-label={STATUS_LABEL[column.status]} className="flex w-[280px] shrink-0 flex-col">
      <h2 className="m-0 mb-2 flex items-center gap-2 px-1 text-[13px] font-medium">
        <StatusIcon status={column.status} />
        <span>{STATUS_LABEL[column.status]}</span>
        <span className="text-xs font-normal text-muted-foreground" data-testid={`count-${column.status}`}>{column.items.length}{column.nextCursor ? "+" : ""}</span>
      </h2>
      <div ref={setNodeRef} className={cn("flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto rounded-lg border border-transparent bg-surface p-1.5 transition-colors", isOver && "border-primary/40 bg-primary/5")}>
        <SortableContext items={column.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {column.items.map((i) => <SortableCard key={i.id} issue={i} />)}
        </SortableContext>
        {column.items.length === 0 && <p className="m-auto py-4 text-xs text-muted-foreground">No issues</p>}
        {column.nextCursor && (
          <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 text-xs" disabled={loading} onClick={onMore}>
            {loading && <Loader2 className="size-3.5 animate-spin" />}
            Load more {STATUS_LABEL[column.status].toLowerCase()}
          </Button>
        )}
      </div>
    </section>
  );
}

function SortableCard({ issue }: { issue: IssueRow }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: issue.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners} className="select-none outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-ring">
      <Card issue={issue} dragging={isDragging} />
    </div>
  );
}

function Card({ issue, dragging, overlay }: { issue: IssueRow; dragging?: boolean; overlay?: boolean }) {
  return (
    <div className={cn("cursor-grab rounded-lg border bg-card p-2.5 shadow-sm transition-colors hover:border-foreground/20", dragging && "opacity-30", overlay && "rotate-1 cursor-grabbing shadow-xl")}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          {issue.identifier}
          {issue.createdBy === "agent" && issue.status === "backlog" && <AgentMark />}
        </span>
        <ActorAvatar who={issue.assignee} size={16} />
      </div>
      <Link href={`/issues/${issue.identifier}`} draggable={false} className="line-clamp-2 text-[13px] leading-snug hover:underline">{issue.title}</Link>
      <div className="mt-2 flex items-center gap-1.5">
        <PriorityIcon priority={issue.priority as Priority} />
        {issue.labels.slice(0, VISIBLE_LABELS).map((l) => <LabelChip key={l.id} name={l.name} color={l.color} />)}
        {issue.labels.length > VISIBLE_LABELS && <span className="text-[11px] text-muted-foreground">+{issue.labels.length - VISIBLE_LABELS}</span>}
        {issue.estimate != null && <span className="ml-auto font-mono text-[11px] text-muted-foreground">{issue.estimate}pt</span>}
      </div>
    </div>
  );
}
