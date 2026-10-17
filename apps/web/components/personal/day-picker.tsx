"use client";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addDays, addMonths, firstOfMonth, longDate, monthGrid, monthLabel, nextMonday, weekdayName } from "@/lib/personal/days";
import { cn } from "@/lib/utils";

export const PICKER_PANEL = "rounded-lg p-2";
export const PICKER_BUTTON = "rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
// Arrow keys move through the month grid like a calendar.
const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

type DayPickerProps = { day: string | null; today: string; hasReminder: boolean; onSelect: (day: string | null) => void };

/**
 * The Planned day editor (docs/personal-space.md §7.5): Today, Tomorrow and Next week (next Monday), a Monday-first
 * month grid, and Anytime, which warns when it would remove the Reminder. It only reports the choice: the caller
 * writes it (and asks before removing a Reminder). Picking the current day just closes it.
 */
export function DayPicker({ children, align = "end", ...props }: DayPickerProps & { children: ReactNode; align?: "start" | "center" | "end" }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} sideOffset={6} aria-label="Planned day" className={cn(PICKER_PANEL, "w-64")}>
        {/* Its own component, so a closed picker costs a row nothing; it mounts fresh on each opening. */}
        <DayPickerPanel
          {...props}
          onSelect={(next) => {
            setOpen(false);
            if (next !== props.day) props.onSelect(next);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function DayPickerPanel({ day, today, hasReminder, onSelect }: DayPickerProps) {
  const [focused, setFocused] = useState(day ?? today);
  // Always the first of the month shown.
  const [month, setMonth] = useState(() => firstOfMonth(day ?? today));
  const moved = useRef(false);
  const grid = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus();
  }, [focused]);

  const showMonth = (n: number) => {
    const first = addMonths(month, n);
    setMonth(first);
    setFocused(first);
  };
  const onGridKey = (e: KeyboardEvent) => {
    const step = STEP[e.key];
    if (!step) return;
    e.preventDefault();
    const next = addDays(focused, step);
    moved.current = true;
    setFocused(next);
    setMonth(firstOfMonth(next));
  };

  const quick = [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["Next week", nextMonday(today)],
  ] as const;
  const cells = monthGrid(month);
  // The focusable cell: the focused day if it is in this month, else the first of the month.
  const tabStop = firstOfMonth(focused) === month ? focused : month;

  return (
    <>
      <div className="grid grid-cols-3 gap-1 pb-2">
        {quick.map(([label, d]) => (
          <button key={label} type="button" onClick={() => onSelect(d)} className={cn(PICKER_BUTTON, "h-8 border text-[12px]", day === d && "border-primary text-primary")}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[12px] font-medium" aria-live="polite">
          {monthLabel(month)}
        </span>
        <span className="flex">
          <button type="button" aria-label="Previous month" onClick={() => showMonth(-1)} className={cn(PICKER_BUTTON, "grid size-7 place-items-center")}>
            <ChevronLeft className="size-3.5" aria-hidden />
          </button>
          <button type="button" aria-label="Next month" onClick={() => showMonth(1)} className={cn(PICKER_BUTTON, "grid size-7 place-items-center")}>
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </span>
      </div>
      <div aria-hidden className="grid grid-cols-7 text-center text-[10px] text-muted-foreground">
        {WEEKDAYS.map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed weekday initials.
          <span key={i} className="py-1">
            {w}
          </span>
        ))}
      </div>
      <fieldset ref={grid} aria-label={monthLabel(month)} className="m-0 grid min-w-0 grid-cols-7 border-0 p-0" onKeyDown={onGridKey}>
        {cells.map((c) => (
          <button
            key={c}
            type="button"
            data-day={c}
            tabIndex={c === tabStop ? 0 : -1}
            onClick={() => onSelect(c)}
            onFocus={() => setFocused(c)}
            aria-label={`${weekdayName(c)} ${longDate(c)}`}
            aria-pressed={day === c}
            aria-current={c === today ? "date" : undefined}
            className={cn(
              PICKER_BUTTON,
              "m-px grid h-8 place-items-center font-mono text-[11.5px] tabular-nums",
              firstOfMonth(c) !== month && "text-muted-foreground/50",
              c < today && "text-muted-foreground/60",
              c === today && "font-semibold text-primary",
              day === c && "bg-primary text-primary-foreground hover:bg-primary",
            )}
          >
            {Number(c.slice(8))}
          </button>
        ))}
      </fieldset>
      <button type="button" onClick={() => onSelect(null)} className={cn(PICKER_BUTTON, "mt-2 flex h-8 w-full items-center gap-2 px-2 text-[12px]", day === null && "text-primary")}>
        <Inbox className="size-3.5" aria-hidden /> Anytime
        {hasReminder ? <span className="ml-auto text-[11px] text-muted-foreground">removes the Reminder</span> : null}
      </button>
    </>
  );
}
