"use client";
// PROTOTYPE (TRC-148): pieces shared by the Personal Space variants (row, check, chips, time mark, menus).
import { Bell, BellOff, CalendarDays, Check, CornerDownLeft, Inbox, MoreHorizontal, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { addDays, dayLabel, parseQuickAdd, parseRefs, type Todo } from "./data";
import { DayPicker, TimePicker } from "./pickers";
import type { TodoStore } from "./store";

export type Proj = { id: string; key: string; name: string; status: "active" | "paused" | "completed" | "canceled" };
/** The owner's real Projects (from the API), for chips and `@` autocomplete. */
export const ProjectsContext = createContext<Proj[]>([]);

/** Round check: open → done. Dropped shows a dash. 44px hit area on touch, 20px mark. */
export function Check_({ todo, store }: { todo: Todo; store: TodoStore }) {
  const closed = todo.state !== "open";
  return (
    <button
      type="button"
      aria-label={closed ? `Reopen ${todo.title}` : `Mark ${todo.title} done`}
      aria-pressed={todo.state === "done"}
      onClick={(e) => {
        e.stopPropagation();
        closed ? store.reopen(todo.id) : store.close(todo.id, "done");
      }}
      className="-m-3 grid shrink-0 place-items-center p-3 outline-none md:-m-1.5 md:p-1.5 [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-ring"
    >
      <span
        className={cn(
          "grid size-[18px] place-items-center rounded-full border-[1.5px] transition-colors duration-150",
          todo.state === "done" && "border-primary bg-primary text-primary-foreground",
          todo.state === "dropped" && "border-muted-foreground/50 text-muted-foreground",
          todo.state === "open" && "border-muted-foreground/60 hover:border-primary",
        )}
      >
        {todo.state === "done" ? <Check className="size-3" strokeWidth={3} /> : null}
        {todo.state === "dropped" ? <X className="size-3" strokeWidth={2.5} /> : null}
      </span>
    </button>
  );
}

/** Title with `@KEY` chips. Done draws an accent line through it (the Personal Space signature). */
export function Title({ todo, keys, className, linked = true }: { todo: Todo; keys: Set<string>; className?: string; linked?: boolean }) {
  const projects = useContext(ProjectsContext);
  const segs = parseRefs(todo.title, keys);
  const done = todo.state === "done";
  return (
    <span className={cn("min-w-0", todo.state !== "open" && "text-muted-foreground", className)}>
      <span
        className="bg-no-repeat transition-[background-size] duration-300 ease-out motion-reduce:transition-none"
        style={{
          backgroundImage: "linear-gradient(var(--brand), var(--brand))",
          backgroundPosition: "0 58%",
          backgroundSize: done ? "100% 1.5px" : "0% 1.5px",
          WebkitBoxDecorationBreak: "clone",
          boxDecorationBreak: "clone",
        }}
      >
        {segs.map((s, i) =>
          "key" in s ? (
            <Chip key={i} k={s.key} project={projects.find((p) => p.key === s.key)} linked={linked} />
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </span>
    </span>
  );
}

const CHIP = "mx-px inline-flex translate-y-[-1px] items-center rounded-[4px] border bg-surface px-1 align-middle font-mono text-[10.5px] font-medium leading-4 tracking-wide text-foreground/80";

/** A Project reference. Clicking it opens the Project. */
function Chip({ k, project, linked }: { k: string; project?: Proj; linked: boolean }) {
  if (!project || !linked) return <span className={CHIP} title={project ? project.name : undefined}>{k}</span>;
  return (
    <Link
      href={`/projects/${project.id}`}
      title={`Open ${project.name}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(CHIP, "cursor-pointer transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
    >
      {k}
    </Link>
  );
}

/** Reminder time in the left gutter. Failed shows in red; sent is dimmed. */
export function TimeMark({ todo, className }: { todo: Todo; className?: string }) {
  if (!todo.time) return <span className={cn("w-11 shrink-0", className)} aria-hidden />;
  const failed = todo.reminder === "failed";
  return (
    <span
      className={cn(
        "inline-flex w-11 shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums",
        failed ? "text-destructive" : todo.reminder === "sent" || todo.state !== "open" ? "text-muted-foreground/70" : "text-primary",
        className,
      )}
      title={failed ? "Reminder failed to send" : todo.reminder === "sent" ? "Reminder sent" : "Reminder"}
    >
      {failed ? <BellOff className="size-3" /> : <Bell className="size-3" />}
      {todo.time}
    </span>
  );
}

export function ParlaMark({ todo }: { todo: Todo }) {
  if (todo.source !== "parla") return null;
  return <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">via Parla</span>;
}

/** Every move a drag can do, as a menu: the single-pointer alternative for drag and drop. */
export function TodoMenu({ todo, store, trigger }: { todo: Todo; store: TodoStore; trigger?: ReactNode }) {
  const t = store.today;
  const days = Array.from({ length: 7 }, (_, i) => addDays(t, i));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={`Actions for ${todo.title}`}
            onClick={(e) => e.stopPropagation()}
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-100 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <CalendarDays className="size-3.5" /> Move to
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {days.map((d) => (
              <DropdownMenuItem key={d} disabled={todo.day === d} onSelect={() => store.move(todo.id, d)}>
                {dayLabel(d, t)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={todo.day === null} onSelect={() => store.move(todo.id, null)}>
              <Inbox className="size-3.5" /> Anytime
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Bell className="size-3.5" /> Reminder
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuLabel className="text-[11px] text-muted-foreground">{todo.time ? `Now ${todo.time}` : "None yet"}</DropdownMenuLabel>
            {["09:00", "12:30", "15:00", "18:30", "21:00"].map((h) => (
              <DropdownMenuItem key={h} onSelect={() => store.setTime(todo.id, h)}>
                <span className="font-mono">{h}</span>
              </DropdownMenuItem>
            ))}
            {todo.time ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => store.setTime(todo.id, null)}>Remove Reminder</DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        {todo.state === "open" ? (
          <>
            <DropdownMenuItem onSelect={() => store.close(todo.id, "done")}>
              <Check className="size-3.5" /> Mark done
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => store.close(todo.id, "dropped")}>
              <X className="size-3.5" /> Drop
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={() => store.reopen(todo.id)}>Reopen</DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onSelect={() => store.remove(todo.id)}>
          <Trash2 className="size-3.5" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A To-do line: check · time gutter · title · meta · menu. Sub-to-do count when it has children. */
export function TodoRow({
  todo,
  store,
  keys,
  showDay,
  showTime = true,
  selected,
  onSelect,
  handle,
  className,
}: {
  todo: Todo;
  store: TodoStore;
  keys: Set<string>;
  showDay?: boolean;
  showTime?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  handle?: ReactNode;
  className?: string;
}) {
  const kids = store.todos.filter((k) => k.parentId === todo.id);
  const kidsDone = kids.filter((k) => k.state !== "open").length;
  const overdue = todo.state === "open" && todo.day !== null && todo.day < store.today;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: prototype; the title button below is the keyboard path.
    <div
      onClick={onSelect}
      className={cn(
        "group/row relative flex min-h-11 items-center gap-3 rounded-md px-2 text-[13px] md:min-h-9",
        onSelect && "hover:bg-accent/60",
        selected && "bg-accent",
        className,
      )}
    >
      {handle}
      <Check_ todo={todo} store={store} />
      {showTime ? (
        <TimePicker todo={todo} store={store}>
          <button type="button" aria-label={todo.time ? `Change Reminder (${todo.time})` : "Add a Reminder"} className="group/time -my-1 shrink-0 rounded-md py-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
            {todo.time ? (
              <TimeMark todo={todo} />
            ) : (
              <span className="flex w-11 items-center gap-1 font-mono text-[11px] text-muted-foreground/0 group-hover/row:text-muted-foreground/50 group-focus-visible/time:text-muted-foreground">
                <Bell className="size-3" /> ––:––
              </span>
            )}
          </button>
        </TimePicker>
      ) : null}
      {/* biome-ignore lint/a11y/useSemanticElements: prototype; a <button> cannot contain the chip links. */}
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect?.();
          }
        }}
        className="flex min-w-0 flex-1 cursor-default items-center gap-2 text-left outline-none focus-visible:underline"
      >
        <Title todo={todo} keys={keys} className="truncate" />
        {todo.details ? <span aria-label="Has details" className="size-1 shrink-0 rounded-full bg-muted-foreground/50" /> : null}
      </span>
      {kids.length ? (
        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground tabular-nums" title="Sub-to-dos done">
          {kidsDone}/{kids.length}
        </span>
      ) : null}
      <ParlaMark todo={todo} />
      <DayPicker todo={todo} store={store} align="end">
        {showDay && todo.day ? (
          <button type="button" aria-label={`Change Planned day (${dayLabel(todo.day, store.today)})`} className={cn("shrink-0 rounded-md px-1.5 py-1 text-[11px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", overdue ? "text-destructive" : "text-muted-foreground")}>
            {dayLabel(todo.day, store.today)}
          </button>
        ) : (
          <button type="button" aria-label="Change Planned day" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-100 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100">
            <CalendarDays className="size-3.5" />
          </button>
        )}
      </DayPicker>
      <TodoMenu todo={todo} store={store} />
    </div>
  );
}

/**
 * Text input with `@` Project autocomplete: typing `@` (then letters of a key or name) lists the active and paused
 * Projects; ↑ ↓ to move, Enter or Tab to insert `@KEY `, Esc to close. Enter submits the form when the list is closed.
 */
export function MentionInput({ value, onChange, placeholder, className, inputClassName, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; inputClassName?: string; autoFocus?: boolean }) {
  const projects = useContext(ProjectsContext);
  const ref = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const m = value.slice(0, caret).match(/(^|\s)@([A-Za-z0-9-]*)$/);
  const q = m ? m[2].toLowerCase() : null;
  const matches =
    q === null
      ? []
      : projects
          .filter((p) => p.status === "active" || p.status === "paused")
          .filter((p) => p.key.toLowerCase().startsWith(q) || p.name.toLowerCase().includes(q))
          .sort((a, b) => Number(!a.key.toLowerCase().startsWith(q)) - Number(!b.key.toLowerCase().startsWith(q)) || a.key.localeCompare(b.key))
          .slice(0, 7);
  const token = m ? `${caret}:${m[2]}` : null;
  const open = matches.length > 0 && token !== dismissed;
  const sel = Math.min(active, matches.length - 1);

  const pick = (p: Proj) => {
    if (!m) return;
    const start = caret - m[2].length - 1;
    const after = value.slice(caret).replace(/^\S*/, "");
    const next = `${value.slice(0, start)}@${p.key} ${after.replace(/^\s+/, "")}`;
    const pos = start + p.key.length + 2;
    onChange(next);
    setActive(0);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const track = (e: { currentTarget: HTMLInputElement }) => setCaret(e.currentTarget.selectionStart ?? e.currentTarget.value.length);

  return (
    <span className={cn("relative block", className)}>
      <input
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls="mention-list"
        aria-autocomplete="list"
        aria-activedescendant={open ? `mention-${matches[sel].id}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          track(e);
          setActive(0);
        }}
        onSelect={track}
        onClick={track}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((sel + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((sel - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            pick(matches[sel]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDismissed(token);
          }
        }}
        onBlur={() => setTimeout(() => setDismissed(token), 120)}
        onFocus={() => setDismissed(null)}
        className={inputClassName}
      />
      {open ? (
        <ul id="mention-list" role="listbox" aria-label="Projects" className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          {matches.map((p, i) => (
            <li
              key={p.id}
              id={`mention-${p.id}`}
              role="option"
              aria-selected={i === sel}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px]", i === sel && "bg-accent")}
            >
              <span className="w-12 shrink-0">
                <span className={CHIP}>{p.key}</span>
              </span>
              <span className="truncate">{p.name}</span>
              {p.status === "paused" ? <span className="ml-auto text-[11px] text-muted-foreground">paused</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}

/** Quick add with a live read-back of what it understood. */
export function QuickAdd({ store, defaultDay, keys, placeholder, className, autoFocus }: { store: TodoStore; defaultDay: string | null; keys: Set<string>; placeholder?: string; className?: string; autoFocus?: boolean }) {
  const [v, setV] = useState("");
  const p = parseQuickAdd(v, store.today);
  const day = p.day ?? defaultDay;
  const preview: Todo = { id: "preview", title: p.title, day, time: p.time, reminder: p.time ? "pending" : null, state: "open", parentId: null, position: 0, source: "dashboard" };
  return (
    <form
      className={cn("rounded-lg border bg-card", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!p.title) return;
        store.add({ title: p.title, day, time: p.time });
        setV("");
      }}
    >
      <label className="flex h-10 items-center gap-2 px-3">
        <Plus className="size-4 shrink-0 text-muted-foreground" />
        <span className="sr-only">New To-do</span>
        <MentionInput
          value={v}
          onChange={setV}
          autoFocus={autoFocus}
          placeholder={placeholder ?? "Add a To-do. Type @ for a Project, or: call Luca tomorrow 15:00"}
          className="min-w-0 flex-1"
          inputClassName="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
        />
        {v ? <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      </label>
      {v && p.title ? (
        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[12px] text-muted-foreground">
          <TimeMark todo={preview} />
          <Title todo={preview} keys={keys} linked={false} className="truncate text-foreground" />
          <span className="ml-auto shrink-0">{day ? dayLabel(day, store.today) : "Anytime"}</span>
        </div>
      ) : null}
    </form>
  );
}

const FIELD = "-mx-0 flex h-8 w-full items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent";

/** Title shows with chips; click (or Enter) to edit it as text with `@` autocomplete. Enter or blur saves, Esc cancels. */
function EditableTitle({ todo, store, keys }: { todo: Todo; store: TodoStore; keys: Set<string> }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(todo.title);
  const save = () => {
    const next = v.trim();
    if (next && next !== todo.title) store.patch(todo.id, { title: next });
    else setV(todo.title);
    setEditing(false);
  };
  if (!editing)
    return (
      <h2 className="min-w-0 flex-1 text-[15px] font-medium leading-snug">
        {/* biome-ignore lint/a11y/useSemanticElements: prototype; contains the chip links. */}
        <span
          role="button"
          tabIndex={0}
          title="Edit title"
          onClick={() => setEditing(true)}
          onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
          className="-mx-1.5 block cursor-text rounded-md px-1.5 py-0.5 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Title todo={todo} keys={keys} />
        </span>
      </h2>
    );
  return (
    <form
      className="min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTimeout(save, 130);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          setV(todo.title);
          setEditing(false);
        }
      }}
    >
      <MentionInput
        value={v}
        onChange={setV}
        autoFocus
        inputClassName="-mx-1.5 w-[calc(100%+12px)] rounded-md border bg-transparent px-1.5 py-0.5 text-[15px] font-medium leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
    </form>
  );
}

/** Details pane content: title, Planned day, Reminder, Details text, Sub-to-dos. */
export function DetailsBody({ todo, store, keys }: { todo: Todo; store: TodoStore; keys: Set<string> }) {
  const kids = store.todos.filter((k) => k.parentId === todo.id).sort((a, b) => (a.day ?? "9") .localeCompare(b.day ?? "9"));
  const parent = todo.parentId ? store.todos.find((p) => p.id === todo.parentId) : null;
  const [sub, setSub] = useState("");
  return (
    <div className="space-y-5">
      {parent ? <p className="text-[11px] text-muted-foreground">Sub-to-do of {parent.title}</p> : null}
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <Check_ todo={todo} store={store} />
        </div>
        <EditableTitle key={todo.id} todo={todo} store={store} keys={keys} />
      </div>
      <dl className="grid grid-cols-[88px_1fr] items-center gap-y-1 text-[12px]">
        <dt className="text-muted-foreground">Planned day</dt>
        <dd>
          <DayPicker todo={todo} store={store}>
            <button type="button" className={cn(FIELD, todo.state === "open" && todo.day && todo.day < store.today && "text-destructive", !todo.day && "text-muted-foreground")}>
              <CalendarDays className="size-3.5 opacity-60" />
              {todo.day ? `${dayLabel(todo.day, store.today)}${["Today", "Tomorrow", "Yesterday"].includes(dayLabel(todo.day, store.today)) ? ` · ${new Date(`${todo.day}T12:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}` : ""}` : "Anytime"}
            </button>
          </DayPicker>
        </dd>
        <dt className="text-muted-foreground">Reminder</dt>
        <dd>
          <TimePicker todo={todo} store={store}>
            <button type="button" className={cn(FIELD, !todo.time && "text-muted-foreground")}>
              {todo.time ? <TimeMark todo={todo} className="w-auto" /> : <><Bell className="size-3.5 opacity-60" /> Add a Reminder</>}
            </button>
          </TimePicker>
        </dd>
        {todo.reminder === "failed" ? <dd className="col-start-2 px-2 pb-1 text-[11px] text-destructive">Telegram refused it. Check the bot in Settings.</dd> : null}
        <dt className="text-muted-foreground">Created</dt>
        <dd className="px-2 text-muted-foreground">{todo.source === "parla" ? "via Parla" : "in the dashboard"}</dd>
      </dl>
      <div>
        <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Details</p>
        <textarea
          defaultValue={todo.details}
          key={todo.id}
          onBlur={(e) => store.patch(todo.id, { details: e.target.value || undefined })}
          placeholder="Add details"
          rows={3}
          className="w-full resize-none rounded-md border bg-transparent px-2.5 py-2 text-[13px] outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>
      {!todo.parentId ? (
        <div>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">Sub-to-dos {kids.length ? `· ${kids.filter((k) => k.state !== "open").length}/${kids.length}` : ""}</p>
          <div className="-mx-2">
            {kids.map((k) => (
              <TodoRow key={k.id} todo={k} store={store} keys={keys} showDay />
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const p = parseQuickAdd(sub, store.today);
              if (!p.title) return;
              store.add({ title: p.title, day: p.day, time: p.time, parentId: todo.id });
              setSub("");
            }}
          >
            <MentionInput
              value={sub}
              onChange={setSub}
              placeholder="Add a Sub-to-do"
              inputClassName="mt-1 h-8 w-full rounded-md bg-transparent px-2 text-[13px] outline-none placeholder:text-muted-foreground/60 focus-visible:bg-accent/50"
            />
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function SectionLabel({ children, count, tone }: { children: ReactNode; count?: number; tone?: "danger" }) {
  return (
    <h3 className={cn("flex items-baseline gap-2 px-2 pb-1 pt-5 text-[11px] font-medium uppercase tracking-[0.08em]", tone === "danger" ? "text-destructive" : "text-muted-foreground")}>
      {children}
      {count !== undefined ? <span className="font-mono tabular-nums opacity-70">{count}</span> : null}
    </h3>
  );
}
