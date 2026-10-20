"use client";
import { reminderTimeSchema } from "@traccia/shared";
import { Bell } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { dayLabel, isMomentPast, type OwnerNow, ownerNow } from "@/lib/personal/days";
import { cn } from "@/lib/utils";
import { PICKER_BUTTON, PICKER_PANEL } from "./day-picker";

export const REMINDER_PRESETS = ["09:00", "12:30", "15:00", "18:00", "20:30", "22:00"] as const;

/** Why a preset is disabled (docs/personal-space.md §7.5): the tooltip on it, and the line under the presets. */
const PAST_PRESET_TOOLTIP = "That time has already passed";
export const PAST_PRESETS_NOTE = "Times that have already passed are disabled.";

/** Whether any preset has already passed on `day`: then the line under the presets says why they are disabled. */
export const anyPresetPast = (day: string, now: OwnerNow) => REMINDER_PRESETS.some((h) => isMomentPast(day, h, now));

type ReminderPickerProps = { day: string | null; time: string | null; today: string; timeZone: string; onSelect: (time: string | null) => void };

/**
 * The Reminder editor (docs/personal-space.md §7.5): presets, an exact time, and Remove. A moment already past is
 * disabled, as the API would refuse it. An Anytime To-do gets today as its Planned day. It only reports the choice.
 */
export function ReminderPicker({ children, align = "start", ...props }: ReminderPickerProps & { children: ReactNode; align?: "start" | "center" | "end" }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} sideOffset={6} aria-label="Reminder" className={cn(PICKER_PANEL, "w-56")}>
        {/* Mounts on each opening, so "now" is read then. */}
        <ReminderPickerPanel
          {...props}
          onSelect={(next) => {
            setOpen(false);
            if (next !== props.time) props.onSelect(next);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function ReminderPickerPanel({ day, time, today, timeZone, onSelect }: ReminderPickerProps) {
  const [value, setValue] = useState(time ?? "");
  const [now] = useState(() => ownerNow(timeZone));
  const errorId = useId();
  const target = day ?? today;
  const past = (h: string) => isMomentPast(target, h, now);
  const valid = reminderTimeSchema.safeParse(value).success;
  const valuePast = valid && past(value);
  const anyPast = anyPresetPast(target, now);
  const noteId = useId();

  return (
    <>
      <p className="px-1 pb-2 text-[11px] text-muted-foreground">
        Reminder on {dayLabel(target, today)}
        {day ? "" : " (sets the Planned day)"}
      </p>
      {target < now.today ? <p className="px-1 pb-2 text-[11px] text-destructive">Its Planned day has passed: move it first.</p> : null}
      <TooltipProvider>
        <div className="grid grid-cols-3 gap-1">
          {REMINDER_PRESETS.map((h) => {
            const isPast = past(h);
            // A disabled button takes no pointer events: the tooltip hangs on the span around it.
            const cell = (
              <span key={h}>
                <button
                  type="button"
                  disabled={isPast}
                  aria-describedby={isPast ? noteId : undefined}
                  onClick={() => onSelect(h)}
                  className={cn(PICKER_BUTTON, "h-8 w-full border font-mono text-[12px] disabled:pointer-events-none disabled:opacity-35", time === h && "border-primary text-primary")}
                >
                  {h}
                </button>
              </span>
            );
            if (!isPast) return cell;
            return (
              <Tooltip key={h}>
                <TooltipTrigger asChild>{cell}</TooltipTrigger>
                <TooltipContent>{PAST_PRESET_TOOLTIP}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
      {anyPast ? (
        <p id={noteId} className="px-1 pt-1.5 text-[11px] text-muted-foreground">
          {PAST_PRESETS_NOTE}
        </p>
      ) : null}
      <form
        className="mt-2 flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !valuePast) onSelect(value);
        }}
      >
        <Bell className="ml-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="time"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Exact time"
          aria-invalid={valuePast || undefined}
          aria-describedby={valuePast ? errorId : undefined}
          className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button type="submit" disabled={!valid || valuePast} className={cn(PICKER_BUTTON, "h-8 bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40")}>
          Set
        </button>
      </form>
      {valuePast ? (
        <p id={errorId} className="px-1 pt-1.5 text-[11px] text-destructive">
          That time has already passed.
        </p>
      ) : null}
      {time ? (
        <button type="button" onClick={() => onSelect(null)} className={cn(PICKER_BUTTON, "mt-2 h-8 w-full px-2 text-left text-[12px] text-muted-foreground hover:text-foreground")}>
          Remove Reminder
        </button>
      ) : null}
    </>
  );
}
