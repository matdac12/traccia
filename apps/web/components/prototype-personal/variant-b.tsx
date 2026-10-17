"use client";
// PROTOTYPE (TRC-148) Variant B, "Board of days": one column per day (Overdue, Today, the next six days) plus
// Anytime. Planning is dragging a card to another day; the card menu does the same without a drag.
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { BookCheck } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { addDays, dayLabel, toDate, type Todo } from "./data";
import { Check_, DetailsBody, ParlaMark, QuickAdd, TimeMark, Title, TodoMenu, TodoRow } from "./shared";
import { byPosition, type TodoStore } from "./store";

export const name = "Board of days";

const OVERDUE = "overdue";
const ANYTIME = "anytime";

export function VariantB({ store, keys }: { store: TodoStore; keys: Set<string> }) {
  const { todos, today } = store;
  const [selected, setSelected] = useState<string | null>(null);
  const [logbook, setLogbook] = useState(false);
  const [dragging, setDragging] = useState<Todo | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const open = todos.filter((t) => t.state === "open");
  const overdue = open.filter((t) => t.day && t.day < today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const sel = todos.find((t) => t.id === selected) ?? null;

  const columns: { id: string; items: Todo[] }[] = [
    ...(overdue.length ? [{ id: OVERDUE, items: overdue.sort((a, b) => (a.day ?? "").localeCompare(b.day ?? "")) }] : []),
    ...days.map((d) => ({
      id: d,
      items: [...open.filter((t) => t.day === d).sort(byPosition), ...(d === today ? todos.filter((t) => t.state !== "open" && t.closedOn === today && t.day === today) : [])],
    })),
    { id: ANYTIME, items: open.filter((t) => t.day === null && !t.parentId).sort(byPosition) },
  ];

  const onEnd = (e: DragEndEvent) => {
    setDragging(null);
    const to = e.over?.id ? String(e.over.id) : null;
    if (!to || to === OVERDUE) return;
    store.move(String(e.active.id), to === ANYTIME ? null : to);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 sm:px-4">
        <QuickAdd store={store} keys={keys} defaultDay={today} className="max-w-xl flex-1" />
        <button type="button" onClick={() => setLogbook(true)} className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[12px] text-muted-foreground hover:bg-accent/60">
          <BookCheck className="size-3.5" /> Logbook
        </button>
      </div>
      <DndContext sensors={sensors} onDragStart={(e) => setDragging(todos.find((t) => t.id === e.active.id) ?? null)} onDragEnd={onEnd} onDragCancel={() => setDragging(null)}>
        <div className="flex min-h-0 flex-1 snap-x snap-mandatory gap-0 overflow-x-auto">
          {columns.map((c) => (
            <Column key={c.id} id={c.id} today={today}>
              {c.items.map((t) => (
                <Card key={t.id} todo={t} store={store} keys={keys} onOpen={() => setSelected(t.id)} showDay={c.id === OVERDUE} />
              ))}
              {!c.items.length ? <p className="px-2 py-6 text-center text-[11px] text-muted-foreground/70">Drop a To-do here</p> : null}
            </Column>
          ))}
        </div>
        <DragOverlay dropAnimation={null}>{dragging ? <CardFace todo={dragging} store={store} keys={keys} lifted /> : null}</DragOverlay>
      </DndContext>

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle className="sr-only">To-do</DialogTitle>
          {sel ? <DetailsBody todo={sel} store={store} keys={keys} /> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={logbook} onOpenChange={setLogbook}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle className="text-[15px]">Logbook</DialogTitle>
          {[...new Set(todos.filter((t) => t.closedOn).map((t) => t.closedOn as string))].sort().reverse().map((d) => (
            <section key={d}>
              <h3 className="border-b px-2 pb-1 pt-3 text-[12px] font-medium">{dayLabel(d, today)}</h3>
              {todos.filter((t) => t.closedOn === d).map((t) => <TodoRow key={t.id} todo={t} store={store} keys={keys} />)}
            </section>
          ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Column({ id, today, children }: { id: string; today: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: id === OVERDUE });
  const isToday = id === today;
  const date = id !== OVERDUE && id !== ANYTIME ? toDate(id) : null;
  return (
    <section
      ref={setNodeRef}
      aria-label={id === OVERDUE ? "Overdue" : id === ANYTIME ? "Anytime" : dayLabel(id, today)}
      className={cn(
        "flex w-[85vw] shrink-0 snap-start flex-col border-r sm:w-[264px]",
        isOver && "bg-accent/40",
        id === OVERDUE && "bg-destructive/[0.03]",
        id === ANYTIME && "bg-surface",
      )}
    >
      <header className={cn("flex items-end gap-2 border-b px-3 pb-2 pt-3", isToday && "shadow-[inset_0_2px_0_var(--brand)]")}>
        {date ? (
          <>
            <span className={cn("font-[family-name:var(--font-geist-sans)] text-[26px] font-semibold leading-none tracking-[-0.04em] tabular-nums", isToday ? "text-foreground" : "text-muted-foreground")}>
              {date.getDate()}
            </span>
            <span className="pb-0.5 text-[11px] leading-tight text-muted-foreground">
              <span className={cn("block font-medium", isToday && "text-primary")}>{dayLabel(id, today)}</span>
              {date.toLocaleDateString("en-GB", { weekday: "long" })}
            </span>
          </>
        ) : (
          <span className={cn("pb-0.5 text-[12px] font-medium", id === OVERDUE ? "text-destructive" : "text-muted-foreground")}>{id === OVERDUE ? "Overdue" : "Anytime"}</span>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">{children}</div>
    </section>
  );
}

function Card({ todo, store, keys, onOpen, showDay }: { todo: Todo; store: TodoStore; keys: Set<string>; onOpen: () => void; showDay?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: todo.id, disabled: todo.state !== "open" });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn("touch-manipulation outline-none", isDragging && "opacity-30")}>
      <CardFace todo={todo} store={store} keys={keys} onOpen={onOpen} showDay={showDay} />
    </div>
  );
}

function CardFace({ todo, store, keys, onOpen, showDay, lifted }: { todo: Todo; store: TodoStore; keys: Set<string>; onOpen?: () => void; showDay?: boolean; lifted?: boolean }) {
  const kids = store.todos.filter((k) => k.parentId === todo.id);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: prototype.
    <div
      onClick={onOpen}
      className={cn("group/row rounded-lg border bg-card p-2.5 text-[13px] transition-colors hover:border-foreground/20", lifted && "rotate-[-1.5deg] shadow-lg", todo.state !== "open" && "bg-transparent")}
    >
      <div className="flex items-start gap-2.5">
        <div className="pt-px">
          <Check_ todo={todo} store={store} />
        </div>
        <div className="min-w-0 flex-1">
          <Title todo={todo} keys={keys} linked={!lifted} className="line-clamp-3 leading-snug" />
        </div>
        <TodoMenu todo={todo} store={store} />
      </div>
      {todo.time || kids.length || todo.source === "parla" || showDay || todo.details ? (
        <div className="mt-1.5 flex items-center gap-2 pl-[30px] text-[11px] text-muted-foreground">
          {todo.time ? <TimeMark todo={todo} className="w-auto" /> : null}
          {kids.length ? <span className="font-mono tabular-nums">{kids.filter((k) => k.state !== "open").length}/{kids.length}</span> : null}
          {showDay && todo.day ? <span className="text-destructive">{dayLabel(todo.day, store.today)}</span> : null}
          {todo.details ? <span>Details</span> : null}
          <span className="ml-auto"><ParlaMark todo={todo} /></span>
        </div>
      ) : null}
    </div>
  );
}
