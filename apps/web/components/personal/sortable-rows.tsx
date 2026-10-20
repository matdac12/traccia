"use client";
import { type Announcements, closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Todo } from "@traccia/shared";
import { GripVertical } from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import { bucketOf, dropMove } from "@/lib/personal/todo-changes";
import { useTodoActions } from "./todo-actions";
import { TodoRow } from "./todo-row";

/** The bucket of the row being dragged: rows of any other bucket are no place to drop it. */
const DraggingBucket = createContext<string | null>(null);

/**
 * Drag to reorder (docs/personal-space.md §7.5) for one list, Today or Anytime: `rows` are its sortable rows in the
 * order it shows them. A row only moves within its bucket (one Planned day or Anytime, under one parent): while it is
 * dragged the others are not drop targets, for the pointer and the keyboard alike (dnd-kit's `KeyboardSensor`: Space
 * or Enter on the handle, the arrows, Space or Enter to drop, Esc to cancel). The drop goes through the page's writes,
 * so it shows at once and goes back if the API refuses it. The row's "…" menu is the single-pointer alternative.
 */
export function SortableRows({ id, rows, children }: { id: string; rows: Todo[]; children: ReactNode }) {
  const actions = useTodoActions();
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const rowOf = (rowId: string | number) => rows.find((t) => t.id === rowId);
  const title = (rowId: string | number) => `“${rowOf(rowId)?.title ?? "To-do"}”`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${title(active.id)}.`,
    onDragOver: ({ active, over }) => (over && over.id !== active.id ? `${title(active.id)} is now at ${title(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => (over && over.id !== active.id ? `${title(active.id)} moved to ${title(over.id)}.` : `${title(active.id)} dropped where it was.`),
    onDragCancel: ({ active }) => `Moving ${title(active.id)} was cancelled.`,
  };

  const onEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const todo = rowOf(active.id);
    const move = todo && over ? dropMove(rows, todo.id, String(over.id)) : null;
    if (todo && move) void actions.move(todo, move);
  };

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: "To reorder, press Space or Enter, move with the arrow keys, then press Space or Enter to drop it, or Escape to cancel." },
      }}
      onDragStart={({ active }) => {
        const todo = rowOf(active.id);
        setDragging(todo ? bucketOf(todo) : null);
      }}
      onDragEnd={onEnd}
      onDragCancel={() => setDragging(null)}
    >
      <DraggingBucket.Provider value={dragging}>{children}</DraggingBucket.Provider>
    </DndContext>
  );
}

/** One run of sortable rows in the order shown (a list, or one parent's Sub-to-dos inside it). */
export function SortableGroup({ rows, children }: { rows: Todo[]; children: ReactNode }) {
  return (
    <SortableContext items={rows.map((t) => t.id)} strategy={verticalListSortingStrategy}>
      {children}
    </SortableContext>
  );
}

/** A `TodoRow` that drags by a handle shown on hover (from `md` up), left of its check. */
export function SortableTodoRow({ todo, parentTitle, children }: { todo: Todo; parentTitle?: string; children?: ReactNode }) {
  const dragging = useContext(DraggingBucket);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: todo.id,
    disabled: { draggable: false, droppable: dragging !== null && dragging !== bucketOf(todo) },
  });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`Reorder “${todo.title}”`}
      className="absolute -left-5 top-1/2 z-[1] hidden -translate-y-1/2 cursor-grab touch-none rounded text-muted-foreground/60 opacity-0 outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100 active:cursor-grabbing md:block"
    >
      <GripVertical className="size-3.5" aria-hidden />
    </button>
  );
  return (
    <TodoRow todo={todo} parentTitle={parentTitle} drag={{ ref: setNodeRef, style: { transform: CSS.Translate.toString(transform), transition }, dragging: isDragging, handle }}>
      {children}
    </TodoRow>
  );
}
