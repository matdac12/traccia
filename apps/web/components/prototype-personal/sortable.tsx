"use client";
// PROTOTYPE (TRC-148): drag to reorder within one bucket (a day, or Anytime). The row menu is the non-drag path.
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";
import type { Todo } from "./data";

export function SortableList({ items, onReorder, render }: { items: Todo[]; onReorder: (ids: string[]) => void; render: (t: Todo, handle: ReactNode) => ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = items.map((t) => t.id);
  const onEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    onReorder(arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {items.map((t) => (
          <SortableItem key={t.id} id={t.id}>
            {(handle) => render(t, handle)}
          </SortableItem>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder"
      onClick={(e) => e.stopPropagation()}
      className="absolute -left-5 top-1/2 hidden -translate-y-1/2 cursor-grab touch-none text-muted-foreground/60 opacity-0 outline-none group-hover/row:opacity-100 focus-visible:opacity-100 md:block"
    >
      <GripVertical className="size-3.5" />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "relative z-10 rounded-md bg-card shadow-sm ring-1 ring-border" : undefined}
    >
      {children(handle)}
    </div>
  );
}
