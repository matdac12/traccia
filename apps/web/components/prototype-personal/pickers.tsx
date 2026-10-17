"use client";
// PROTOTYPE (TRC-148): inline editors for a To-do's Planned day and Reminder time, opened from wherever they show.
import { Bell, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { Popover } from "radix-ui";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { addDays, dayLabel, iso, type Todo, toDate } from "./data";
import type { TodoStore } from "./store";

const PANEL = "z-50 rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95";

/** Planned day editor: quick picks, a month calendar, and Anytime. */
export function DayPicker({ todo, store, children, align = "start" }: { todo: Todo; store: TodoStore; children: ReactNode; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const t = store.today;
  const [month, setMonth] = useState(() => {
    const d = toDate(todo.day ?? t);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const set = (day: string | null) => {
    store.move(todo.id, day);
    setOpen(false);
  };
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7));
  const cells = Array.from({ length: 42 }, (_, i) => iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  const nextMonday = addDays(t, ((8 - toDate(t).getDay()) % 7) || 7);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild onClick={(e) => e.stopPropagation()}>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={6} className={cn(PANEL, "w-64")} onClick={(e) => e.stopPropagation()}>
          <div className="grid grid-cols-3 gap-1 pb-2">
            {[
              ["Today", t],
              ["Tomorrow", addDays(t, 1)],
              ["Next week", nextMonday],
            ].map(([label, d]) => (
              <button key={label} type="button" onClick={() => set(d)} className={cn("h-8 rounded-md border text-[12px] hover:bg-accent", todo.day === d && "border-primary text-primary")}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-[12px] font-medium">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
            <span className="flex">
              <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid size-7 place-items-center rounded-md hover:bg-accent"><ChevronLeft className="size-3.5" /></button>
              <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="grid size-7 place-items-center rounded-md hover:bg-accent"><ChevronRight className="size-3.5" /></button>
            </span>
          </div>
          <div className="grid grid-cols-7 text-center text-[10px] text-muted-foreground">
            {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => <span key={i} className="py-1">{w}</span>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((c) => {
              const inMonth = toDate(c).getMonth() === month.getMonth();
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => set(c)}
                  aria-label={dayLabel(c, t)}
                  aria-pressed={todo.day === c}
                  className={cn(
                    "m-px grid h-8 place-items-center rounded-md font-mono text-[11.5px] tabular-nums hover:bg-accent",
                    !inMonth && "text-muted-foreground/50",
                    c < t && "text-muted-foreground/60",
                    c === t && "font-semibold text-primary",
                    todo.day === c && "bg-primary text-primary-foreground hover:bg-primary",
                  )}
                >
                  {toDate(c).getDate()}
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => set(null)} className={cn("mt-2 flex h-8 w-full items-center gap-2 rounded-md px-2 text-[12px] hover:bg-accent", todo.day === null && "text-primary")}>
            <Inbox className="size-3.5" /> Anytime
            {todo.time ? <span className="ml-auto text-[11px] text-muted-foreground">removes the Reminder</span> : null}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Reminder editor: presets, an exact time, remove. A moment already past today is refused. */
export function TimePicker({ todo, store, children, align = "start" }: { todo: Todo; store: TodoStore; children: ReactNode; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(todo.time ?? "");
  const day = todo.day ?? store.today;
  const now = new Date();
  const nowHm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const past = (h: string) => day < store.today || (day === store.today && h <= nowHm);
  const set = (h: string | null) => {
    if (h && past(h)) return;
    store.setTime(todo.id, h);
    setOpen(false);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setV(todo.time ?? "");
      }}
    >
      <Popover.Trigger asChild onClick={(e) => e.stopPropagation()}>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={6} className={cn(PANEL, "w-56")} onClick={(e) => e.stopPropagation()}>
          <p className="px-1 pb-2 text-[11px] text-muted-foreground">
            Reminder on {dayLabel(day, store.today)}
            {todo.day ? "" : " (sets the Planned day)"}
          </p>
          <div className="grid grid-cols-3 gap-1">
            {["09:00", "12:30", "15:00", "18:00", "20:30", "22:00"].map((h) => (
              <button
                key={h}
                type="button"
                disabled={past(h)}
                onClick={() => set(h)}
                className={cn("h-8 rounded-md border font-mono text-[12px] hover:bg-accent disabled:opacity-35 disabled:hover:bg-transparent", todo.time === h && "border-primary text-primary")}
              >
                {h}
              </button>
            ))}
          </div>
          <form
            className="mt-2 flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{2}:\d{2}$/.test(v)) set(v);
            }}
          >
            <Bell className="ml-1 size-3.5 text-muted-foreground" />
            <input type="time" value={v} onChange={(e) => setV(e.target.value)} aria-label="Exact time" className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
            <button type="submit" className="h-8 rounded-md bg-primary px-2.5 text-[12px] font-medium text-primary-foreground disabled:opacity-40" disabled={!v || past(v)}>
              Set
            </button>
          </form>
          {v && past(v) ? <p className="px-1 pt-1.5 text-[11px] text-destructive">That time has already passed.</p> : null}
          {todo.time ? (
            <button type="button" onClick={() => set(null)} className="mt-2 h-8 w-full rounded-md px-2 text-left text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground">
              Remove Reminder
            </button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
