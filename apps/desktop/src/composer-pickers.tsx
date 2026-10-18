import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { TIME_PASSED } from "./composer";
import { addDays, dayLabel } from "./days";
import {
  canPageBack,
  monthGrid,
  monthName,
  monthOf,
  moveDayCursor,
  moveTimeIndex,
  nextMonday,
  pageCursor,
  reminderChips,
  startIndex,
  timeCandidates,
  typedPassed,
} from "./pickers";

/**
 * Variant G's Day and Reminder pickers (docs/desktop-app.md §5.4, §5.5): a panel under the composer's fields. They
 * only report a pick; the composer applies it (src/composer.ts `pickDay`, `pickTime`) and the card puts the focus
 * back in the title. Esc is the card's: it closes the picker before the composer.
 */

const PANEL = "mt-2 rounded-lg border bg-background p-1.5";
const CHIPS = "flex flex-wrap gap-1 border-b pb-1.5 mb-1";
const NOTE = "px-2 pt-1 text-[11px] text-muted-foreground";

function Chip({
  current,
  onClick,
  children,
}: {
  current: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={current}
      onClick={onClick}
      className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11.5px] ${current ? "border-transparent bg-primary text-primary-foreground" : "hover:border-primary"}`}
    >
      {children}
    </button>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[3px] border px-1 font-mono text-[10px]">
      {children}
    </kbd>
  );
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * The Day picker (§5.4): Today, Tomorrow, Next Mon and Anytime, then a Monday-first month grid with ‹ ›. Past days
 * are disabled and it doesn't page before the current month. The highlighted day has the focus: arrows move it a
 * day or a week, PgUp and PgDn a month, Home back to today; Enter or Space picks it.
 */
export function DayPicker({
  day,
  today,
  hasReminder,
  onPick,
}: {
  /** The draft's Planned day, null for Anytime. */
  day: string | null;
  today: string;
  hasReminder: boolean;
  onPick: (day: string | null) => void;
}) {
  const [cursor, setCursor] = useState(day ?? today);
  const [view, setView] = useState(monthOf(day ?? today));
  const gridRef = useRef<HTMLDivElement>(null);
  /** Moved by a key (or just opened): the focus follows the highlighted day. */
  const follow = useRef(true);

  useLayoutEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)
      ?.focus();
  }, [cursor]);

  const move = (next: string) => {
    setCursor(next);
    setView(monthOf(next));
  };
  const page = (n: 1 | -1) => {
    if (n < 0 && !canPageBack(view, today)) return;
    move(pageCursor(cursor, n, today));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    const target = event.target as HTMLElement;
    if (event.key === "Enter" && target.dataset.day) {
      event.preventDefault();
      onPick(cursor);
      return;
    }
    const next = moveDayCursor(cursor, event.key, today);
    if (next === null) return;
    event.preventDefault();
    follow.current = true;
    move(next);
  };

  const { lead, days } = monthGrid(view);
  const chips: [string, string | null][] = [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["Next Mon", nextMonday(today)],
    ["Anytime", null],
  ];

  return (
    // The grid's keys, from whichever of its buttons has the focus.
    <fieldset
      aria-label="Day"
      data-picker="day"
      onKeyDown={onKeyDown}
      className={PANEL}
    >
      <div className={CHIPS}>
        {chips.map(([label, value]) => (
          <Chip
            key={label}
            current={day === value}
            onClick={() => onPick(value)}
          >
            {label}
          </Chip>
        ))}
      </div>
      <div className="flex items-center justify-between px-0.5 pb-0.5 text-[12.5px]">
        <MonthButton
          label="Previous month"
          disabled={!canPageBack(view, today)}
          onClick={() => page(-1)}
        >
          ‹
        </MonthButton>
        <b className="font-semibold" aria-live="polite">
          {monthName(view)}
        </b>
        <MonthButton label="Next month" onClick={() => page(1)}>
          ›
        </MonthButton>
      </div>
      <div ref={gridRef} className="grid grid-cols-7 gap-0.5 px-0.5 pb-0.5">
        {WEEKDAYS.map((w, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the seven weekday letters, never reordered
            key={i}
            aria-hidden="true"
            className="pb-0.5 text-center text-[10px] text-muted-foreground"
          >
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: empty cells before the 1st
          <span key={`lead-${i}`} />
        ))}
        {days.map((d) => {
          const picked = d === day;
          return (
            <button
              key={d}
              type="button"
              data-day={d}
              aria-label={dayLabel(d, "full")}
              aria-pressed={picked}
              aria-current={d === today ? "date" : undefined}
              tabIndex={d === cursor ? 0 : -1}
              disabled={d < today}
              onClick={() => onPick(d)}
              className={`h-[26px] rounded-[5px] text-xs outline-offset-[-2px] disabled:cursor-default disabled:bg-transparent disabled:opacity-30 ${picked ? "bg-primary text-primary-foreground" : d === today ? "font-semibold text-primary hover:bg-accent" : "hover:bg-accent"} ${d === cursor ? "outline-2 outline-ring" : ""}`}
            >
              {Number(d.slice(8, 10))}
            </button>
          );
        })}
      </div>
      <p className={NOTE}>
        {hasReminder && "Anytime removes the Reminder · "}
        <Kbd>←↑↓→</Kbd> move · <Kbd>PgUp/PgDn</Kbd> month · <Kbd>↵</Kbd> pick
      </p>
    </fieldset>
  );
}

function MonthButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="size-[26px] rounded-[5px] text-base text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
    >
      {children}
    </button>
  );
}

/**
 * The Reminder picker (§5.5): chips, a typed time (`9`, `930`, `9:30`, `14:30`, `2pm`, `2:15p`) that narrows the
 * list, and the list in 15-minute steps. Today only times still ahead can be picked. The focus stays in the typed
 * field: ↑ ↓ move the highlight past the times already gone, Enter picks it.
 */
export function ReminderPicker({
  time,
  onToday,
  anytime,
  now,
  onPick,
}: {
  /** The draft's Reminder, or null. */
  time: string | null;
  /** The draft is on today, or on Anytime, which a time moves to today. */
  onToday: boolean;
  anytime: boolean;
  /** The clock in the Owner timezone. */
  now: string;
  onPick: (time: string | null) => void;
}) {
  const listId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const candidates = timeCandidates({ query, onToday, now });
  const [index, setIndex] = useState(() =>
    startIndex(candidates, { query, current: time, onToday }),
  );
  /** The list opens with the highlight at its top (09:00 on other days); later it only scrolls to keep it shown. */
  const opened = useRef(false);
  const passed = typedPassed(query, candidates);
  const active = candidates[index];

  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!list || !option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (!opened.current) list.scrollTop = top;
    else if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight;
    opened.current = true;
  }, [index]);

  const pick = (i: number) => {
    const c = candidates[i];
    if (c && !c.past) onPick(c.time);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIndex(
        moveTimeIndex(candidates, index, event.key === "ArrowDown" ? 1 : -1),
      );
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      pick(index);
    }
  };

  return (
    <fieldset aria-label="Reminder" data-picker="reminder" className={PANEL}>
      <div className={CHIPS}>
        {reminderChips(onToday, now).map((chip) => (
          <Chip
            key={chip.label}
            current={chip.time === time}
            onClick={() => onPick(chip.time)}
          >
            {chip.label}{" "}
            <span className="font-mono text-[11px] opacity-70">
              {chip.time}
            </span>
          </Chip>
        ))}
      </div>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Reminder time"
        aria-autocomplete="list"
        aria-expanded={candidates.length > 0}
        aria-controls={listId}
        aria-activedescendant={active ? `${listId}-${index}` : undefined}
        aria-invalid={passed || undefined}
        aria-describedby={passed ? errorId : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Type a time: 9, 930, 14:30, 2pm"
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setIndex(
            startIndex(timeCandidates({ query: next, onToday, now }), {
              query: next,
              current: time,
              onToday,
            }),
          );
        }}
        onKeyDown={onKeyDown}
        className="mt-0.5 h-[30px] w-full rounded-md border border-input bg-transparent px-2 font-mono text-[12.5px] text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/70 focus:border-ring"
      />
      {passed && (
        <p id={errorId} className="px-2 pt-1 text-[11px] text-destructive">
          {TIME_PASSED}
        </p>
      )}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Times"
        className="relative mt-1.5 max-h-[168px] overflow-y-auto [scrollbar-width:thin]"
      >
        {candidates.length === 0 ? (
          <p className={NOTE}>Type a time like 9, 930, 14:30 or 2pm.</p>
        ) : (
          candidates.map((c, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the keys are the typed field's (aria-activedescendant)
            <div
              key={c.time}
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              tabIndex={-1}
              aria-selected={i === index}
              aria-disabled={c.past || undefined}
              onClick={() => pick(i)}
              onMouseEnter={() => !c.past && setIndex(i)}
              className={`flex h-7 items-center justify-between rounded-[5px] px-2 font-mono text-[12.5px] ${i === index ? "bg-accent" : ""} ${c.time === time ? "text-primary" : ""} ${c.past ? "cursor-not-allowed opacity-40" : "cursor-default"}`}
            >
              <span>{c.time}</span>
              <small className="font-sans text-[11px] text-muted-foreground">
                {c.hint}
              </small>
            </div>
          ))
        )}
      </div>
      <p className={NOTE}>
        <Kbd>↑↓</Kbd> move · <Kbd>↵</Kbd> pick
        {anytime && " · a time moves it to Today"}
        {time && (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => onPick(null)}
              className="text-destructive hover:underline"
            >
              Remove Reminder
            </button>
          </>
        )}
      </p>
    </fieldset>
  );
}
