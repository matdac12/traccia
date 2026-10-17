"use client";
// PROTOTYPE (TRC-148) Variant C, "Calendar first": a month grid is the page; the selected day's agenda and the
// Anytime tray sit beside it. Drag an agenda or Anytime row onto any day to plan it.
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { dayLabel, iso, longDate, type Todo, toDate, weekday } from "./data";
import { DetailsBody, QuickAdd, SectionLabel, TimeMark, Title, TodoRow } from "./shared";
import { byPosition, type TodoStore } from "./store";

export const name = "Calendar first";

export function VariantC({ store, keys }: { store: TodoStore; keys: Set<string> }) {
  const { todos, today } = store;
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(() => { const d = toDate(today); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Todo | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const sel = todos.find((t) => t.id === selected) ?? null;
  const open = todos.filter((t) => t.state === "open");

  // Monday-first 6-week grid.
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7));
  const cells = Array.from({ length: 42 }, (_, i) => iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));

  const agenda = [...open.filter((t) => t.day === day).sort(byPosition), ...todos.filter((t) => t.state !== "open" && t.day === day)];
  const overdue = day === today ? open.filter((t) => t.day && t.day < today) : [];
  const anytime = open.filter((t) => t.day === null && !t.parentId).sort(byPosition);

  const onEnd = (e: DragEndEvent) => {
    setDragging(null);
    if (e.over) store.move(String(e.active.id), String(e.over.id));
  };

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDragging(todos.find((t) => t.id === e.active.id) ?? null)} onDragEnd={onEnd} onDragCancel={() => setDragging(null)}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <section aria-label="Month" className="flex min-h-0 flex-col p-3 sm:p-4 lg:flex-1">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-[family-name:var(--font-geist-sans)] text-[22px] font-semibold tracking-[-0.03em]">
              {month.toLocaleDateString("en-GB", { month: "long" })} <span className="text-muted-foreground">{month.getFullYear()}</span>
            </h2>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid size-9 place-items-center rounded-md hover:bg-accent md:size-7"><ChevronLeft className="size-4" /></button>
              <button type="button" onClick={() => { const d = toDate(today); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setDay(today); }} className="h-9 rounded-md px-2 text-[12px] hover:bg-accent md:h-7">Today</button>
              <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="grid size-9 place-items-center rounded-md hover:bg-accent md:size-7"><ChevronRight className="size-4" /></button>
            </div>
          </div>
          <div className="grid grid-cols-7 border-b pb-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => <span key={w} className="px-1.5">{w}</span>)}
          </div>
          <div className="grid flex-1 grid-cols-7 grid-rows-6">
            {cells.map((c) => (
              <Cell key={c} day={c} store={store} keys={keys} inMonth={toDate(c).getMonth() === month.getMonth()} selected={c === day} onSelect={() => setDay(c)} />
            ))}
          </div>
        </section>

        <aside className="flex shrink-0 flex-col border-t lg:w-[380px] lg:overflow-y-auto lg:border-l lg:border-t-0">
          <div className="p-4">
            <header className="mb-3">
              <h2 className="font-[family-name:var(--font-geist-sans)] text-[26px] font-semibold leading-none tracking-[-0.03em]">{day === today ? "Today" : weekday(day)}</h2>
              <p className="mt-1.5 text-[12px] text-muted-foreground">{day === today ? weekday(day) + ", " : ""}{longDate(day)}</p>
            </header>
            <QuickAdd store={store} keys={keys} defaultDay={day} placeholder={`Add to ${dayLabel(day, today)}`} />
            {overdue.length ? (
              <>
                <SectionLabel tone="danger" count={overdue.length}>Overdue</SectionLabel>
                {overdue.map((t) => <DragRow key={t.id} todo={t} store={store} keys={keys} onOpen={() => setSelected(t.id)} showDay />)}
              </>
            ) : null}
            <SectionLabel count={agenda.filter((t) => t.state === "open").length}>{dayLabel(day, today)}</SectionLabel>
            {agenda.length ? agenda.map((t) => <DragRow key={t.id} todo={t} store={store} keys={keys} onOpen={() => setSelected(t.id)} />) : <p className="px-2 py-3 text-[12px] text-muted-foreground">Nothing planned. Drag something here from Anytime.</p>}
          </div>
          <div className="mt-auto border-t bg-surface p-4">
            <SectionLabel count={anytime.length}>Anytime</SectionLabel>
            {anytime.map((t) => <DragRow key={t.id} todo={t} store={store} keys={keys} onOpen={() => setSelected(t.id)} />)}
          </div>
        </aside>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="flex w-64 rotate-[-1.5deg] items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-[13px] shadow-lg">
            <TimeMark todo={dragging} />
            <Title todo={dragging} keys={keys} linked={false} className="truncate" />
          </div>
        ) : null}
      </DragOverlay>
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle className="sr-only">To-do</DialogTitle>
          {sel ? <DetailsBody todo={sel} store={store} keys={keys} /> : null}
        </DialogContent>
      </Dialog>
    </DndContext>
  );
}

function Cell({ day, store, keys, inMonth, selected, onSelect }: { day: string; store: TodoStore; keys: Set<string>; inMonth: boolean; selected: boolean; onSelect: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: day });
  const { todos, today } = store;
  const items = todos.filter((t) => t.day === day && t.state === "open").sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99") || a.position - b.position);
  const closed = todos.filter((t) => t.day === day && t.state === "done").length;
  const past = day < today;
  const isToday = day === today;
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${dayLabel(day, today)}, ${items.length} open`}
      className={cn(
        "flex min-h-14 min-w-0 flex-col gap-0.5 border-b border-r p-1 text-left outline-none transition-colors first:border-l focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-20 sm:p-1.5 [&:nth-child(7n+1)]:border-l",
        !inMonth && "bg-surface/60 text-muted-foreground/60",
        selected && "bg-accent",
        isOver && "bg-primary/10",
      )}
    >
      <span className="flex items-center gap-1">
        <span
          className={cn(
            "grid size-6 place-items-center rounded-full font-[family-name:var(--font-geist-sans)] text-[12px] font-medium tabular-nums",
            isToday && "bg-primary text-primary-foreground",
          )}
        >
          {toDate(day).getDate()}
        </span>
        {past && items.length ? <span className="size-1.5 rounded-full bg-destructive" aria-hidden /> : null}
        {closed ? <span className="ml-auto hidden font-mono text-[10px] text-muted-foreground/70 sm:inline">✓{closed}</span> : null}
      </span>
      {/* Phones: dots. Wider: the first three titles with their times. */}
      <span className="flex flex-wrap gap-0.5 sm:hidden">
        {items.slice(0, 4).map((t) => <span key={t.id} className={cn("size-1.5 rounded-full", t.time ? "bg-primary" : "bg-muted-foreground/50")} />)}
      </span>
      <span className="hidden min-w-0 flex-col gap-px sm:flex">
        {items.slice(0, 3).map((t) => (
          <span key={t.id} className={cn("flex min-w-0 items-center gap-1 rounded-[3px] px-1 text-[10.5px] leading-4", past ? "text-destructive" : "text-foreground/80")}>
            {t.time ? <span className="shrink-0 font-mono text-primary">{t.time}</span> : null}
            <span className="truncate"><Title todo={t} keys={keys} linked={false} /></span>
          </span>
        ))}
        {items.length > 3 ? <span className="px-1 text-[10px] text-muted-foreground">+{items.length - 3} more</span> : null}
      </span>
    </button>
  );
}

function DragRow({ todo, store, keys, onOpen, showDay }: { todo: Todo; store: TodoStore; keys: Set<string>; onOpen: () => void; showDay?: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: todo.id, disabled: todo.state !== "open" });
  return (
    <div ref={setNodeRef} className={cn("relative", isDragging && "opacity-30")}>
      <TodoRow
        todo={todo}
        store={store}
        keys={keys}
        onSelect={onOpen}
        showDay={showDay}
        className="pl-5"
        handle={
          todo.state === "open" ? (
            <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label="Drag to a day" onClick={(e) => e.stopPropagation()} className="absolute left-0 top-1/2 -translate-y-1/2 cursor-grab touch-none text-muted-foreground/50 hover:text-foreground">
              <GripVertical className="size-3.5" />
            </button>
          ) : null
        }
      />
    </div>
  );
}
