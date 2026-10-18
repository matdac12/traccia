// PROTOTYPE, throwaway (branch prototype/desktop-done-row). Question: how should a done To-do look in the window?
// Five variants of the real list, switchable with ← → or the bar at the bottom (`?variant=A`…`E`).
// Run: `pnpm --filter desktop prototype`. In-memory fixtures only; nothing talks to the API.
import {
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Moon,
  Plus,
  RotateCcw,
  Sun,
} from "lucide-react";
import { type ReactNode, StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Todo } from "./api-client";
import { dayLabel } from "./days";
import { buildSections, headingOf, listCounts } from "./list";
import { titleSegments } from "./title";
import { CHIP } from "./todo-list";
import "./styles.css";

const TODAY = "2026-10-19";

const VARIANTS = {
  A: {
    name: "Struck in place (today)",
    about:
      "What ships now. The check fills orange, the title greys out under an orange line, and the row stays where it was until the window hides.",
  },
  B: {
    name: "Leaves the list",
    about:
      "The check fills and the line draws, then after a beat the row folds away. A toast offers Undo for 5 s, and the title bar counts what you did (“· 2 done”). The list only ever shows what's left.",
  },
  C: {
    name: "Done shelf",
    about:
      "The row strikes, then moves to a “Done today” shelf at the bottom: dimmed, no line, with the time it was closed. The shelf folds with its chevron and lasts all day, across hides (that needs a fetch of today's closed To-dos).",
  },
  D: {
    name: "Quiet in place",
    about:
      "No line and no orange. The row stays put but fades back: a muted filled check, a dimmed title, and the parent line, n/m and Reminder hidden. The row gets shorter, so the open ones stand out.",
  },
  E: {
    name: "Receipt line",
    about:
      "The row shrinks to a thin receipt in its place: a small orange tick, the title, and the time it was closed. Hover or select it to get Reopen. Open rows stay full height; done ones take about two thirds of the space.",
  },
} as const;
type Variant = keyof typeof VARIANTS;
const KEYS = Object.keys(VARIANTS) as Variant[];

// ---------------------------------------------------------------- fixtures

let n = 0;
const STAMP = "2026-10-19T08:00:00.000Z";
function td(o: Partial<Todo> & { title: string }): Todo {
  n += 1;
  return {
    id: o.id ?? `p${n}`,
    references: [],
    day: null,
    reminder: null,
    state: "open",
    closedAt: null,
    parentId: null,
    subTodos: null,
    position: n,
    details: null,
    source: "desktop",
    url: "#",
    createdAt: STAMP,
    updatedAt: STAMP,
    ...o,
  };
}
const reminder = (time: string, status: "pending" | "sent" = "pending") => ({
  time,
  status,
  failure: null,
  sentAt: null,
});
const TRC = [{ key: "TRC", projectId: "pr_trc", projectDeleted: false }];

function fixtures(): Todo[] {
  n = 0;
  return [
    td({ title: "Renew car insurance", day: "2026-10-16" }),
    td({
      title: "Pay rent",
      day: TODAY,
      state: "done",
      closedAt: "2026-10-19T07:12:00.000Z",
    }),
    td({
      id: "gym",
      title: "Gym",
      day: TODAY,
      reminder: reminder("18:30", "sent"),
      state: "done",
      closedAt: "2026-10-19T08:41:00.000Z",
    }),
    td({
      title: "Reply to Luca about the @TRC launch",
      day: TODAY,
      references: TRC,
    }),
    td({
      id: "flights",
      title: "Book flights",
      day: TODAY,
      parentId: "lisbon",
      reminder: reminder("12:00"),
    }),
    td({ title: "Buy coffee beans", day: TODAY }),
    td({ id: "lisbon", title: "Plan Lisbon trip", day: "2026-10-20" }),
    td({ title: "Find a hotel", day: "2026-10-20", parentId: "lisbon" }),
    td({
      title: "Call the dentist",
      day: "2026-10-20",
      reminder: reminder("09:30"),
    }),
    td({
      title: "Dinner with Giulia",
      day: "2026-10-22",
      reminder: reminder("20:00"),
    }),
    td({ title: "Fix the bike light" }),
    td({ title: "Read “Designing Data-Intensive Applications”" }),
  ];
}

/** A parent's n/m, recomputed from its Sub-to-dos, as the API would. */
function withCounts(todos: Todo[]): Todo[] {
  return todos.map((t) => {
    const subs = todos.filter((s) => s.parentId === t.id);
    if (subs.length === 0) return t;
    return {
      ...t,
      subTodos: {
        done: subs.filter((s) => s.state === "done").length,
        total: subs.length,
      },
    };
  });
}

const clock = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

// ---------------------------------------------------------------- the page

function initialVariant(): Variant {
  const v = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return KEYS.includes(v as Variant) ? (v as Variant) : "A";
}

/** Rows that are animating out of their place (B, C): first the line draws, then the row folds. */
type Settling = Record<string, "strike" | "fold">;

function Prototype() {
  const [variant, setVariantState] = useState<Variant>(initialVariant);
  const [todos, setTodos] = useState<Todo[]>(() => withCounts(fixtures()));
  const [selectedId, setSelected] = useState<string | null>(null);
  const [settling, setSettling] = useState<Settling>({});
  const [toast, setToast] = useState<{ text: string; id: string } | null>(null);
  const [shelfOpen, setShelfOpen] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const timers = useRef<number[]>([]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const setVariant = (v: Variant) => {
    setVariantState(v);
    setSettling({});
    setToast(null);
    const url = new URL(location.href);
    url.searchParams.set("variant", v);
    history.replaceState(null, "", url);
  };
  const cycle = (step: number) =>
    setVariant(
      KEYS[
        (KEYS.indexOf(variant) + step + KEYS.length) % KEYS.length
      ] as Variant,
    );

  const reset = () => {
    for (const t of timers.current) clearTimeout(t);
    setTodos(withCounts(fixtures()));
    setSettling({});
    setToast(null);
    setSelected(null);
  };

  const later = (ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms));
  };

  const toggle = (id: string) => {
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;
    const closing = todo.state === "open";
    setTodos((all) =>
      withCounts(
        all.map((t) =>
          t.id === id
            ? {
                ...t,
                state: closing ? "done" : "open",
                closedAt: closing ? new Date().toISOString() : null,
              }
            : t,
        ),
      ),
    );
    if (closing && (variant === "B" || variant === "C")) {
      setSettling((s) => ({ ...s, [id]: "strike" }));
      later(variant === "B" ? 650 : 550, () =>
        setSettling((s) => (s[id] ? { ...s, [id]: "fold" } : s)),
      );
      later(variant === "B" ? 950 : 850, () =>
        setSettling(({ [id]: _, ...rest }) => rest),
      );
    }
    if (!closing) setSettling(({ [id]: _, ...rest }) => rest);
    if (closing && variant === "B") {
      setToast({ text: `Done “${todo.title}”`, id });
      later(5000, () => setToast((t) => (t?.id === id ? null : t)));
    }
  };

  /** What the window does on hide: closed rows leave (C keeps today's on its shelf). */
  const hideAndShow = () => {
    setHidden(true);
    setToast(null);
    setSettling({});
    later(450, () => {
      if (variant !== "C")
        setTodos((all) => withCounts(all.filter((t) => t.state === "open")));
      setSelected(null);
      setHidden(false);
    });
  };

  // What sits in the list's sections, per variant.
  const inPlace =
    variant === "B" || variant === "C"
      ? todos.filter((t) => t.state === "open" || settling[t.id])
      : todos;
  const shelf =
    variant === "C"
      ? todos
          .filter((t) => t.state === "done" && !settling[t.id])
          .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))
      : [];
  const doneToday = todos.filter((t) => t.state === "done").length;

  const sections = buildSections(inPlace, TODAY);
  const order = [
    ...sections.flatMap((s) => s.items.map((t) => t.id)),
    ...(shelfOpen ? shelf.map((t) => t.id) : []),
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") cycle(1);
      else if (e.key === "ArrowLeft") cycle(-1);
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const i = selectedId ? order.indexOf(selectedId) : -1;
        setSelected(
          e.key === "ArrowDown"
            ? (order[Math.min(order.length - 1, i + 1)] ?? null)
            : i <= 0
              ? null
              : (order[i - 1] ?? null),
        );
      } else if (e.key === " " && selectedId) toggle(selectedId);
      else if (e.key.toLowerCase() === "h") hideAndShow();
      else if (e.key === "Escape") setSelected(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const counts = listCounts(todos, TODAY);
  const byId = new Map(todos.map((t) => [t.id, t]));
  const rowProps = (t: Todo) => ({
    todo: t,
    parent: t.parentId ? byId.get(t.parentId) : undefined,
    selected: t.id === selectedId,
    onSelect: () => setSelected(t.id),
    onToggle: () => {
      setSelected(t.id);
      toggle(t.id);
    },
  });

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{
        background: dark
          ? "radial-gradient(1200px 700px at 30% 30%, #2a3550, #161c2c 60%, #0d111b)"
          : "radial-gradient(1200px 700px at 30% 30%, #c9d8f0, #8fa9d6 60%, #6f8cc2)",
      }}
    >
      <Notes variant={variant} todos={todos} settling={settling} />

      {/* The window, at its real size. */}
      <div className="absolute right-[12%] top-1/2 flex h-[520px] w-[380px] -translate-y-1/2 flex-col overflow-hidden rounded-lg bg-background text-foreground shadow-[0_16px_48px_rgb(0_0_0/28%),0_2px_8px_rgb(0_0_0/12%)]">
        {hidden ? (
          <div className="grid flex-1 place-items-center text-xs text-muted-foreground">
            (hidden… showing again)
          </div>
        ) : (
          <>
            <header className="flex h-10 flex-none items-center gap-2 border-b pr-2 pl-3.5">
              <h1 className="font-semibold">Personal</h1>
              <span className="text-xs text-muted-foreground">
                {counts.today} today · {counts.open} open
                {variant === "B" && doneToday > 0 && (
                  <span className="text-primary"> · {doneToday} done</span>
                )}
              </span>
              <span className="flex-1" />
              <span className="grid size-[26px] place-items-center rounded-md text-muted-foreground">
                <Plus className="size-[15px]" strokeWidth={2.2} />
              </span>
            </header>
            <main className="relative flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
              <div className="pb-3">
                {sections.map((section) => {
                  const heading = headingOf(section, TODAY);
                  const allDone =
                    (variant === "B" || variant === "C") &&
                    section.kind === "today" &&
                    section.items.length === 0 &&
                    todos.some((t) => t.day === TODAY && t.state === "done");
                  return (
                    <section key={section.key}>
                      <h2
                        className={`sticky top-0 z-[1] flex items-baseline gap-1.5 bg-background px-4 pt-3 pb-1 text-[11.5px] font-semibold ${section.kind === "overdue" ? "text-destructive" : ""}`}
                      >
                        {heading.label}
                        {heading.detail && (
                          <small className="text-[11.5px] font-normal text-muted-foreground">
                            {heading.detail}
                          </small>
                        )}
                        <span className="ml-auto font-normal text-muted-foreground">
                          {section.open || ""}
                        </span>
                      </h2>
                      {section.items.length === 0 ? (
                        <p className="pt-1 pr-4 pb-2 pl-11 text-xs text-muted-foreground">
                          {allDone ? "All done for today." : "Nothing planned."}
                        </p>
                      ) : (
                        section.items.map((t) => (
                          <Fold key={t.id} folding={settling[t.id] === "fold"}>
                            <RowFor
                              variant={variant}
                              showDay={section.kind === "overdue"}
                              {...rowProps(t)}
                            />
                          </Fold>
                        ))
                      )}
                    </section>
                  );
                })}

                {variant === "C" && shelf.length > 0 && (
                  <section className="mt-2 border-t pt-1">
                    <h2 className="flex items-baseline gap-1.5 px-4 pt-2 pb-1 text-[11.5px] font-semibold text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => setShelfOpen((o) => !o)}
                        className="flex items-center gap-1 hover:text-foreground"
                      >
                        <ChevronDown
                          className={`size-3.5 transition-transform ${shelfOpen ? "" : "-rotate-90"}`}
                        />
                        Done today
                      </button>
                      <span className="ml-auto font-normal">
                        {shelf.length}
                      </span>
                    </h2>
                    {shelfOpen &&
                      shelf.map((t) => (
                        <ShelfRow key={t.id} {...rowProps(t)} />
                      ))}
                  </section>
                )}
              </div>
            </main>
            {toast && (
              <div className="absolute inset-x-2.5 bottom-2.5 z-[5] flex items-center gap-2.5 rounded-md bg-foreground px-2.5 py-2 text-xs text-background shadow-[0_4px_16px_rgba(0,0,0,0.2)]">
                <span className="min-w-0 flex-1 truncate">{toast.text}</span>
                <button
                  type="button"
                  onClick={() => {
                    toggle(toast.id);
                    setToast(null);
                  }}
                  className="font-semibold text-primary"
                >
                  Undo
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {import.meta.env.DEV && (
        <Switcher
          variant={variant}
          onCycle={cycle}
          dark={dark}
          onTheme={() => setDark((d) => !d)}
          onHide={hideAndShow}
          onReset={reset}
        />
      )}
    </div>
  );
}

/** Folds a row's height to nothing (B, C), so the rows below slide up instead of jumping. */
function Fold({
  folding,
  children,
}: {
  folding: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${folding ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]"}`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- rows

type RowProps = {
  todo: Todo;
  parent: Todo | undefined;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
};

function RowFor(props: RowProps & { variant: Variant; showDay: boolean }) {
  const { variant, ...rest } = props;
  if (props.todo.state === "done") {
    if (variant === "D") return <QuietRow {...rest} />;
    if (variant === "E") return <ReceiptRow {...rest} />;
  }
  return <StandardRow {...rest} />;
}

const rowShell = (selected: boolean) =>
  `relative mx-1.5 flex items-center gap-2.5 rounded-md px-2.5 hover:bg-accent ${selected ? "bg-accent shadow-[inset_2px_0_0_var(--primary)]" : ""}`;

/** The row as it ships (A, and the open rows of every variant; B and C strike through it before it leaves). */
function StandardRow({
  todo,
  parent,
  selected,
  onSelect,
  onToggle,
  showDay,
}: RowProps & { showDay: boolean }) {
  const done = todo.state === "done";
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: prototype.
    // biome-ignore lint/a11y/noStaticElementInteractions: prototype.
    <div
      data-state={todo.state}
      onClick={onSelect}
      className={`${rowShell(selected)} min-h-[34px] py-1`}
    >
      <CheckButton
        done={done}
        onClick={onToggle}
        tone={
          done ? "border-primary bg-primary text-primary-foreground" : undefined
        }
      />
      <span className="todo-title min-w-0 flex-1 leading-[1.35]">
        <span className="todo-strike">
          <Title todo={todo} />
        </span>
        {parent && (
          <span className="mt-px block truncate text-[11px] text-muted-foreground opacity-80">
            ↳ <Title todo={parent} />
          </span>
        )}
      </span>
      {todo.subTodos && todo.subTodos.total > 0 && (
        <span className="flex-none font-mono text-[10.5px] text-muted-foreground tabular-nums">
          {todo.subTodos.done}/{todo.subTodos.total}
        </span>
      )}
      {todo.reminder && <ReminderTime todo={todo} />}
      {showDay && todo.day && (
        <span className="flex-none text-[11px] text-destructive">
          {dayLabel(todo.day, "weekday")}
        </span>
      )}
    </div>
  );
}

/** D: stays, fades back, sheds its extras. */
function QuietRow({ todo, selected, onSelect, onToggle }: RowProps) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: prototype.
    // biome-ignore lint/a11y/noStaticElementInteractions: prototype.
    <div
      data-state="done"
      onClick={onSelect}
      className={`${rowShell(selected)} min-h-[28px] py-0.5`}
    >
      <CheckButton
        done
        onClick={onToggle}
        tone="border-transparent bg-muted-foreground/25 text-foreground/70"
      />
      <span className="min-w-0 flex-1 truncate leading-[1.35] text-muted-foreground/75">
        <Title todo={todo} muted />
      </span>
    </div>
  );
}

/** E: a thin receipt where the row was. */
function ReceiptRow({ todo, selected, onSelect, onToggle }: RowProps) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: prototype.
    // biome-ignore lint/a11y/noStaticElementInteractions: prototype.
    <div
      data-state="done"
      onClick={onSelect}
      className={`group ${rowShell(selected)} h-[22px] text-[11.5px] text-muted-foreground`}
    >
      <span className="grid w-[18px] flex-none place-items-center">
        <Check className="size-3 text-primary" strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <Title todo={todo} muted />
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`flex-none font-medium text-primary hover:underline ${selected ? "" : "hidden group-hover:inline"}`}
      >
        Reopen
      </button>
      <span
        className={`flex-none font-mono text-[10.5px] tabular-nums ${selected ? "hidden" : "group-hover:hidden"}`}
      >
        {clock(todo.closedAt)}
      </span>
    </div>
  );
}

/** C: a row on the Done today shelf. */
function ShelfRow({ todo, parent, selected, onSelect, onToggle }: RowProps) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: prototype.
    // biome-ignore lint/a11y/noStaticElementInteractions: prototype.
    <div
      data-state="done"
      onClick={onSelect}
      className={`${rowShell(selected)} min-h-[30px] py-0.5`}
    >
      <CheckButton
        done
        onClick={onToggle}
        tone="border-primary/50 bg-primary/15 text-primary"
      />
      <span className="min-w-0 flex-1 leading-[1.35] text-muted-foreground">
        <span className="block truncate">
          <Title todo={todo} muted />
        </span>
        {parent && (
          <span className="block truncate text-[11px] opacity-70">
            ↳ <Title todo={parent} muted />
          </span>
        )}
      </span>
      <span className="flex-none font-mono text-[10.5px] text-muted-foreground tabular-nums">
        {clock(todo.closedAt)}
      </span>
    </div>
  );
}

function CheckButton({
  done,
  onClick,
  tone,
}: {
  done: boolean;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button
      type="button"
      aria-label={done ? "Reopen" : "Mark done"}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`grid size-[18px] flex-none place-items-center rounded-full border-[1.5px] transition-colors ${tone ?? "border-input hover:border-primary"}`}
    >
      <Check
        className={`size-[11px] ${done ? "" : "opacity-0"}`}
        strokeWidth={3.2}
      />
    </button>
  );
}

function Title({
  todo,
  muted = false,
}: {
  todo: Pick<Todo, "title" | "references">;
  muted?: boolean;
}) {
  return (
    <span>
      {titleSegments(todo.title, todo.references).map((s, i) =>
        "key" in s ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional.
          <span key={i} className={`${CHIP} ${muted ? "opacity-60" : ""}`}>
            {s.key}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional.
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

function ReminderTime({ todo }: { todo: Todo }) {
  const r = todo.reminder;
  if (!r) return null;
  const tone =
    todo.state === "open" && r.status === "pending"
      ? "text-primary"
      : "text-muted-foreground opacity-55";
  return (
    <span
      className={`inline-flex min-w-11 flex-none items-center justify-end gap-[3px] font-mono text-[11px] tabular-nums ${tone}`}
    >
      <Bell className="size-[11px]" strokeWidth={2.2} />
      {r.time}
    </span>
  );
}

// ---------------------------------------------------------------- prototype chrome (not part of the design)

function Notes({
  variant,
  todos,
  settling,
}: {
  variant: Variant;
  todos: Todo[];
  settling: Settling;
}) {
  const v = VARIANTS[variant];
  return (
    <aside className="absolute top-1/2 left-[8%] w-[380px] -translate-y-1/2 rounded-xl bg-black/70 p-5 text-[13px] leading-relaxed text-white/90 shadow-xl backdrop-blur">
      <p className="text-[11px] tracking-wider text-white/50 uppercase">
        Prototype · done To-do
      </p>
      <h2 className="mt-1 text-lg font-semibold text-white">
        {variant} · {v.name}
      </h2>
      <p className="mt-2">{v.about}</p>
      <p className="mt-4 text-[11.5px] text-white/60">
        Click a check, or ↑ ↓ and Space. <b>H</b> simulates a hide and show. ← →
        switch variant. Dropping isn't part of this question, so it's left out.
      </p>
      <div className="mt-4 border-t border-white/15 pt-3 font-mono text-[11px] text-white/70">
        {todos
          .filter((t) => t.state !== "open")
          .map((t) => (
            <div key={t.id} className="truncate">
              ✓ {t.title} · {clock(t.closedAt)}
              {settling[t.id] ? ` · ${settling[t.id]}` : ""}
            </div>
          ))}
        {todos.every((t) => t.state === "open") && <div>nothing done</div>}
      </div>
    </aside>
  );
}

function Switcher({
  variant,
  onCycle,
  dark,
  onTheme,
  onHide,
  onReset,
}: {
  variant: Variant;
  onCycle: (step: number) => void;
  dark: boolean;
  onTheme: () => void;
  onHide: () => void;
  onReset: () => void;
}) {
  const btn = "grid size-8 place-items-center rounded-full hover:bg-white/15";
  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black px-2 py-1.5 text-white shadow-[0_8px_30px_rgba(0,0,0,0.45)] ring-1 ring-white/20">
      <button
        type="button"
        className={btn}
        onClick={() => onCycle(-1)}
        aria-label="Previous variant"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-[230px] text-center text-[13px] font-medium">
        {variant}{" "}
        <span className="text-white/60">({VARIANTS[variant].name})</span>
      </span>
      <button
        type="button"
        className={btn}
        onClick={() => onCycle(1)}
        aria-label="Next variant"
      >
        <ChevronRight className="size-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-white/20" />
      <button
        type="button"
        className={btn}
        onClick={onTheme}
        title="Light / dark"
      >
        {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
      <button
        type="button"
        className={btn}
        onClick={onHide}
        title="Hide and show the window (H)"
      >
        <EyeOff className="size-4" />
      </button>
      <button
        type="button"
        className={btn}
        onClick={onReset}
        title="Reset the To-dos"
      >
        <RotateCcw className="size-4" />
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Prototype />
  </StrictMode>,
);
