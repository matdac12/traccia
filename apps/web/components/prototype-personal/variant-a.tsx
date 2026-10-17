"use client";
// PROTOTYPE (TRC-148) Variant A, "Lists": an inner rail of lists (Today, Upcoming, Anytime, Logbook, by Project)
// and one focused list. Today opens on a weekday masthead; Reminder times run down a left gutter.
import { BookCheck, CalendarRange, Inbox, Sun } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { addDays, dayLabel, longDate, parseRefs, type Todo, weekday } from "./data";
import { DetailsBody, QuickAdd, SectionLabel, TodoRow } from "./shared";
import { SortableList } from "./sortable";
import { byPosition, type TodoStore } from "./store";

type List = "today" | "upcoming" | "anytime" | "logbook" | `project:${string}`;

export const name = "Lists";

export function VariantA({ store, keys }: { store: TodoStore; keys: Set<string> }) {
  const [list, setList] = useState<List>("today");
  const [selected, setSelected] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 1180px)");
  const { todos, today } = store;
  const top = todos.filter((t) => !t.parentId || t.day !== null);
  const open = top.filter((t) => t.state === "open");
  const overdue = open.filter((t) => t.day && t.day < today);
  const todayOpen = open.filter((t) => t.day === today);
  const refKeys = [...new Set(open.flatMap((t) => parseRefs(t.title, keys).flatMap((s) => ("key" in s ? [s.key] : []))))].sort();
  const sel = todos.find((t) => t.id === selected) ?? null;

  const nav: { id: List; label: string; icon: ReactNode; count?: number }[] = [
    { id: "today", label: "Today", icon: <Sun className="size-3.5" />, count: todayOpen.length + overdue.length },
    { id: "upcoming", label: "Upcoming", icon: <CalendarRange className="size-3.5" /> },
    { id: "anytime", label: "Anytime", icon: <Inbox className="size-3.5" />, count: todos.filter((t) => t.state === "open" && t.day === null && !t.parentId).length },
    { id: "logbook", label: "Logbook", icon: <BookCheck className="size-3.5" /> },
  ];

  const row = (t: Todo, extra: { showDay?: boolean; handle?: ReactNode } = {}) => (
    <TodoRow todo={t} store={store} keys={keys} selected={selected === t.id} onSelect={() => setSelected(t.id)} {...extra} />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {/* Inner rail; a scrolling tab strip on phones. */}
      <nav aria-label="Personal lists" className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-2 md:w-52 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-2 md:py-3">
        {nav.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => setList(n.id)}
            aria-current={list === n.id ? "page" : undefined}
            className={cn(
              "flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-[13px] text-muted-foreground hover:bg-accent/60 md:h-7",
              list === n.id && "bg-accent text-foreground",
            )}
          >
            <span className={cn(list === n.id && n.id === "today" && "text-primary")}>{n.icon}</span>
            {n.label}
            {n.count ? <span className="ml-auto pl-2 font-mono text-[10.5px] tabular-nums">{n.count}</span> : null}
          </button>
        ))}
        <p className="hidden px-2.5 pb-1 pt-5 text-[11px] font-medium text-muted-foreground md:block">By project</p>
        {refKeys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setList(`project:${k}`)}
            aria-current={list === `project:${k}` ? "page" : undefined}
            className={cn("flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 font-mono text-[12px] text-muted-foreground hover:bg-accent/60 md:h-7", list === `project:${k}` && "bg-accent text-foreground")}
          >
            <span className="rounded-[4px] border bg-surface px-1 text-[10.5px]">{k}</span>
            <span className="ml-auto pl-2 text-[10.5px] tabular-nums">{open.filter((t) => parseRefs(t.title, keys).some((s) => "key" in s && s.key === k)).length}</span>
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[680px] px-4 pb-24 pt-6 md:px-8 md:pt-10">
          {list === "today" ? (
            <>
              <header className="mb-5">
                <h2 className="font-[family-name:var(--font-geist-sans)] text-[34px] font-semibold leading-none tracking-[-0.03em]">{weekday(today)}</h2>
                <p className="mt-2 text-[12px] text-muted-foreground">
                  {longDate(today)} · {todayOpen.length} open · {todayOpen.filter((t) => t.time && t.reminder === "pending").length} Reminders still to come
                </p>
              </header>
              <QuickAdd store={store} keys={keys} defaultDay={today} />
              {overdue.length ? (
                <>
                  <SectionLabel tone="danger" count={overdue.length}>Overdue</SectionLabel>
                  {overdue.sort((a, b) => (a.day ?? "").localeCompare(b.day ?? "")).map((t) => <div key={t.id}>{row(t, { showDay: true })}</div>)}
                </>
              ) : null}
              <SectionLabel count={todayOpen.length}>Today</SectionLabel>
              <SortableList items={todayOpen.sort(byPosition)} onReorder={store.reorder} render={(t, handle) => row(t, { handle })} />
              {top.filter((t) => t.state !== "open" && t.closedOn === today).map((t) => <div key={t.id}>{row(t)}</div>)}
            </>
          ) : null}

          {list === "upcoming" ? (
            <>
              <Heading>Upcoming</Heading>
              {Array.from({ length: 14 }, (_, i) => addDays(today, i + 1)).map((d) => {
                const items = open.filter((t) => t.day === d).sort(byPosition);
                return (
                  <section key={d} className={cn(!items.length && "opacity-60")}>
                    <h3 className="flex items-baseline gap-2 border-b px-2 pb-1 pt-5 text-[12px] font-medium">
                      {dayLabel(d, today)}
                      {!items.length ? <span className="text-[11px] font-normal text-muted-foreground">Nothing planned</span> : null}
                    </h3>
                    {items.map((t) => <div key={t.id}>{row(t)}</div>)}
                  </section>
                );
              })}
            </>
          ) : null}

          {list === "anytime" ? (
            <>
              <Heading sub="To-dos without a Planned day. Give one a day when it is time.">Anytime</Heading>
              <QuickAdd store={store} keys={keys} defaultDay={null} placeholder="Add to Anytime" />
              <div className="mt-3">
                <SortableList
                  items={todos.filter((t) => t.state === "open" && t.day === null && !t.parentId).sort(byPosition)}
                  onReorder={store.reorder}
                  render={(t, handle) => (
                    <>
                      {row(t, { handle })}
                      {todos.filter((k) => k.parentId === t.id).length ? (
                        <div className="ml-7 border-l pl-2">
                          {todos.filter((k) => k.parentId === t.id).map((k) => <div key={k.id}>{row(k, { showDay: true })}</div>)}
                        </div>
                      ) : null}
                    </>
                  )}
                />
              </div>
            </>
          ) : null}

          {list === "logbook" ? (
            <>
              <Heading sub="Everything done or dropped, kept forever.">Logbook</Heading>
              {[...new Set(todos.filter((t) => t.closedOn).map((t) => t.closedOn as string))].sort().reverse().map((d) => (
                <section key={d}>
                  <h3 className="border-b px-2 pb-1 pt-5 text-[12px] font-medium">{dayLabel(d, today)}</h3>
                  {todos.filter((t) => t.closedOn === d).map((t) => <div key={t.id}>{row(t)}</div>)}
                </section>
              ))}
            </>
          ) : null}

          {list.startsWith("project:") ? (
            <>
              <Heading sub="Open To-dos that reference this Project.">
                <span className="rounded-md border bg-surface px-2 font-mono text-[24px]">{list.slice(8)}</span>
              </Heading>
              {open
                .filter((t) => parseRefs(t.title, keys).some((s) => "key" in s && s.key === list.slice(8)))
                .sort((a, b) => (a.day ?? "9999").localeCompare(b.day ?? "9999"))
                .map((t) => <div key={t.id}>{row(t, { showDay: true })}</div>)}
            </>
          ) : null}
        </div>
      </div>

      {sel && wide ? (
        <aside className="w-[340px] shrink-0 overflow-y-auto border-l p-5">
          <button type="button" onClick={() => setSelected(null)} className="mb-4 text-[11px] text-muted-foreground hover:text-foreground">Close</button>
          <DetailsBody todo={sel} store={store} keys={keys} />
        </aside>
      ) : null}
      {!wide ? (
        <Dialog open={!!sel} onOpenChange={(o) => !o && setSelected(null)}>
          <DialogContent className="max-h-[85dvh] overflow-y-auto">
            <DialogTitle className="sr-only">To-do</DialogTitle>
            {sel ? <DetailsBody todo={sel} store={store} keys={keys} /> : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function Heading({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <header className="mb-4">
      <h2 className="font-[family-name:var(--font-geist-sans)] text-[28px] font-semibold leading-none tracking-[-0.03em]">{children}</h2>
      {sub ? <p className="mt-2 text-[12px] text-muted-foreground">{sub}</p> : null}
    </header>
  );
}
