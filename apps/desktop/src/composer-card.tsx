import { PROJECT_STATUSES, type ProjectOption } from "@traccia/shared";
import { Bell, CalendarDays, type LucideIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { Project } from "./api-client";
import { type Composer, dayName, timeOnToday } from "./composer";
import { DayPicker, ReminderPicker } from "./composer-pickers";
import { MentionInput } from "./mention-input";

const isOption = (p: Project): p is Project & ProjectOption =>
  (PROJECT_STATUSES as readonly string[]).includes(p.status);

/**
 * Variant G's floating composer (docs/desktop-app.md §5): a card under the title bar over the dimmed list. The title
 * line with `@` autocomplete, then the Day and Reminder fields and the "↵ add" hint, a red line for what stops the
 * add, and the open picker. Clicking the dimmed list closes it. Esc closes the picker here; with none open it is the
 * list's keyboard's (src/app.tsx), which closes the composer.
 */
export function ComposerCard({
  composer,
  projects,
  today,
}: {
  composer: Composer;
  projects: Project[];
  /** Today in the Owner timezone. */
  today: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const { draft, error, disabled } = composer;
  /** The open picker under the fields (§5.4, §5.5). */
  const [menu, setMenu] = useState<"day" | "time" | null>(null);
  /** Set when the focus goes back to the title once the next render is in. */
  const backToTitle = useRef(true);

  // Focus the title, the caret at the end: on opening (after the character that opened it), after a pick or a
  // closed picker, and again when changes come back on.
  useLayoutEffect(() => {
    if (disabled) backToTitle.current = true;
    if (disabled || !backToTitle.current) return;
    backToTitle.current = false;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  /**
   * Back from a picker, the `@` list stays closed until the next keystroke, even with the caret after an `@KEY`:
   * Enter then adds rather than inserting the key.
   */
  const [quiet, setQuiet] = useState(false);

  const closeMenu = () => {
    setMenu(null);
    setQuiet(true);
    backToTitle.current = true;
  };
  const toggle = (which: "day" | "time") =>
    menu === which ? closeMenu() : setMenu(which);
  const shownMenu = disabled ? null : menu;

  return (
    <>
      {/* The dimmed list: a mouse shortcut, hidden from screen readers; Esc closes too. */}
      <div
        data-scrim
        aria-hidden="true"
        onClick={composer.close}
        className="absolute inset-x-0 top-10 bottom-0 z-[3] bg-background/55"
      />
      <div
        role="dialog"
        aria-label="Add a To-do"
        data-composer
        // Clicks on the card's empty parts keep the focus in the title, so its keys keep working.
        onMouseDown={(event) => {
          if (!(event.target as Element).closest("input, button"))
            event.preventDefault();
        }}
        // Esc closes the open picker first (§5.6), unless the `@` list took it; then the list's keyboard closes the
        // composer.
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented || !shownMenu)
            return;
          event.preventDefault();
          closeMenu();
        }}
        className="absolute inset-x-2 top-[46px] z-[4] rounded-lg border bg-card px-3 py-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.22)]"
      >
        <MentionInput
          inputRef={inputRef}
          aria-label="New To-do"
          placeholder="New To-do… @KEY"
          value={composer.text}
          onValueChange={(text) => {
            setQuiet(false);
            composer.setText(text);
          }}
          quiet={quiet}
          projects={projects.filter(isOption)}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            composer.submit();
          }}
          className="w-full bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
        />
        <div className="mt-2 flex items-center gap-1.5 border-t pt-2">
          <ComposerField
            name="Day"
            icon={CalendarDays}
            value={dayName(draft.day, today)}
            typed={draft.dayTyped}
            tone="set"
            disabled={disabled}
            onOpen={() => toggle("day")}
            expanded={shownMenu === "day"}
          />
          <ComposerField
            name="Reminder"
            icon={Bell}
            value={draft.time ?? "Reminder"}
            typed={draft.timeTyped}
            tone={draft.time ? "reminder" : "unset"}
            disabled={disabled}
            onOpen={() => toggle("time")}
            expanded={shownMenu === "time"}
          />
          <span className="flex-1" />
          <kbd className="rounded-[3px] border px-1 font-mono text-[10px] text-muted-foreground">
            ↵ add
          </kbd>
        </div>
        {error && (
          <p
            id={errorId}
            role="alert"
            className="pt-1.5 text-[11.5px] text-destructive"
          >
            {error}
          </p>
        )}
        {shownMenu === "day" && (
          <DayPicker
            day={draft.day}
            today={composer.today}
            hasReminder={draft.time !== null}
            onPick={(day) => {
              composer.pickDay(day);
              closeMenu();
            }}
          />
        )}
        {shownMenu === "time" && (
          <ReminderPicker
            time={draft.time}
            onToday={timeOnToday(draft, composer.today)}
            anytime={draft.day === null}
            now={composer.now}
            onPick={(time) => {
              composer.pickTime(time);
              closeMenu();
            }}
          />
        )}
      </div>
    </>
  );
}

const FIELD_TONE = {
  unset: "text-muted-foreground",
  set: "text-foreground",
  reminder: "border-primary/40 text-primary",
} as const;

/**
 * A field under the title (§5.3): its icon, its value and a "typed" tag when the title names it. A button that
 * opens its picker (Tab reaches it from the title; Enter or Space opens it).
 */
function ComposerField({
  name,
  icon: Icon,
  value,
  typed,
  tone,
  disabled,
  onOpen,
  expanded,
}: {
  name: string;
  icon: LucideIcon;
  value: string;
  typed: boolean;
  tone: keyof typeof FIELD_TONE;
  disabled: boolean;
  onOpen: () => void;
  expanded: boolean;
}) {
  // A set Reminder stays orange on hover and while open, as in variant G.
  const reminder = tone === "reminder";
  const state = expanded
    ? reminder
      ? "bg-accent"
      : "bg-accent text-foreground"
    : reminder
      ? "hover:bg-accent"
      : "hover:bg-accent hover:text-foreground";
  return (
    <button
      type="button"
      data-field={name}
      title={name}
      aria-haspopup="true"
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onOpen}
      className={`inline-flex h-[26px] items-center gap-[5px] rounded-md border px-2 text-xs disabled:cursor-not-allowed disabled:opacity-60 ${FIELD_TONE[tone]} ${state}`}
    >
      <Icon className="size-3" strokeWidth={2} aria-hidden="true" />
      <span>{value}</span>
      {typed && (
        <span className="font-mono text-[9.5px] text-muted-foreground">
          typed
        </span>
      )}
    </button>
  );
}
