import { PROJECT_STATUSES, type ProjectOption } from "@traccia/shared";
import { Bell, CalendarDays, type LucideIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef } from "react";
import type { Project } from "./api-client";
import { type Composer, dayName } from "./composer";
import { MentionInput } from "./mention-input";

const isOption = (p: Project): p is Project & ProjectOption =>
  (PROJECT_STATUSES as readonly string[]).includes(p.status);

/**
 * Variant G's floating composer (docs/desktop-app.md §5): a card under the title bar over the dimmed list. The title
 * line with `@` autocomplete, then the Day and Reminder fields and the "↵ add" hint, then a red line for what stops
 * the add. Clicking the dimmed list closes it; Esc is the list's keyboard's (src/app.tsx).
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

  // Focus the title, the caret after the character that opened it; again when changes come back on.
  useLayoutEffect(() => {
    if (disabled) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [disabled]);

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
        // Clicks on the card's empty parts keep the focus in the title, so its keys keep working.
        onMouseDown={(event) => {
          if (!(event.target as Element).closest("input, button"))
            event.preventDefault();
        }}
        className="absolute inset-x-2 top-[46px] z-[4] rounded-lg border bg-card px-3 py-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.22)]"
      >
        <MentionInput
          inputRef={inputRef}
          aria-label="New To-do"
          placeholder="New To-do… @KEY"
          value={composer.text}
          onValueChange={composer.setText}
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
          {/* Step 07 (TRC-175) passes `onOpen` and `expanded` to make these the Day and Reminder pickers. */}
          <ComposerField
            name="Day"
            icon={CalendarDays}
            value={dayName(draft.day, today)}
            typed={draft.dayTyped}
            tone="set"
          />
          <ComposerField
            name="Reminder"
            icon={Bell}
            value={draft.time ?? "Reminder"}
            typed={draft.timeTyped}
            tone={draft.time ? "reminder" : "unset"}
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
 * A field under the title (§5.3): its icon, its value and a "typed" tag when the title names it. Read-only until
 * step 07 gives it `onOpen`; then it is a button that opens its picker.
 */
function ComposerField({
  name,
  icon: Icon,
  value,
  typed,
  tone,
  onOpen,
  expanded = false,
}: {
  name: string;
  icon: LucideIcon;
  value: string;
  typed: boolean;
  tone: keyof typeof FIELD_TONE;
  onOpen?: () => void;
  expanded?: boolean;
}) {
  const className = `inline-flex h-[26px] items-center gap-[5px] rounded-md border px-2 text-xs ${FIELD_TONE[tone]}`;
  const content = (
    <>
      <Icon className="size-3" strokeWidth={2} aria-hidden="true" />
      <span>{value}</span>
      {typed && (
        <span className="font-mono text-[9.5px] text-muted-foreground">
          typed
        </span>
      )}
    </>
  );
  if (!onOpen)
    return (
      <span data-field={name} title={name} className={className}>
        {content}
      </span>
    );
  return (
    <button
      type="button"
      data-field={name}
      title={name}
      aria-expanded={expanded}
      onClick={onOpen}
      className={`${className} hover:bg-accent hover:text-foreground ${expanded ? "bg-accent text-foreground" : ""}`}
    >
      {content}
    </button>
  );
}
