"use client";
import { insertProjectKey, keyQueryAt, matchProjects } from "@traccia/shared";
import { type ComponentProps, type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useProjectOptions } from "./projects-context";
import { CHIP } from "./todo-title";

type InputProps = Omit<ComponentProps<"input">, "ref" | "value" | "onChange" | "role" | "type">;

/**
 * A one-line text input with `@` Project autocomplete (docs/personal-space.md §7.5), for quick add, the Sub-to-do
 * input and title editing. Typing `@` lists active and paused Projects; ↑ ↓ move, Enter or Tab inserts `@KEY `, Esc
 * closes. While the list is closed every key reaches the input as usual, so Enter submits the form around it.
 */
export function MentionInput({
  value,
  onValueChange,
  className,
  inputClassName,
  onKeyDown,
  onBlur,
  onFocus,
  ...props
}: InputProps & { value: string; onValueChange: (value: string) => void /** On the input; `className` is on the wrapper the list hangs from. */; inputClassName?: string }) {
  const projects = useProjectOptions();
  const ref = useRef<HTMLInputElement>(null);
  // Where the caret goes once the value with an inserted key has rendered.
  const pendingCaret = useRef<number | null>(null);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  // The `@` run the owner closed with Esc (or by leaving the field); typing on reopens the list.
  const [dismissed, setDismissed] = useState<string | null>(null);

  const keyQuery = keyQueryAt(value, caret);
  const matches = keyQuery ? matchProjects(projects, keyQuery.query) : [];
  // Identifies the `@` run being typed, so a dismissed list stays closed until the run changes.
  const keyQueryId = keyQuery ? `${keyQuery.start}:${keyQuery.query}` : null;
  const open = matches.length > 0 && keyQueryId !== dismissed;
  const selected = Math.min(active, matches.length - 1);
  const optionId = (i: number) => `${listId}-${i}`;

  const pick = (key: string) => {
    const next = insertProjectKey(value, caret, key);
    onValueChange(next.value);
    setActive(0);
    setCaret(next.caret);
    pendingCaret.current = next.caret;
  };

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    ref.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  const track = (input: HTMLInputElement) => setCaret(input.selectionStart ?? input.value.length);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open && !e.nativeEvent.isComposing) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((selected + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick((matches[selected] as (typeof matches)[number]).key);
        return;
      }
      if (e.key === "Escape") {
        // Closing the list is all Esc does here: it must not also cancel an edit around the input.
        e.preventDefault();
        e.stopPropagation();
        setDismissed(keyQueryId);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <span className={cn("relative block", className)}>
      <input
        {...props}
        ref={ref}
        className={inputClassName}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(selected) : undefined}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          track(e.target);
          setActive(0);
        }}
        onSelect={(e) => track(e.currentTarget)}
        onKeyDown={handleKeyDown}
        onFocus={(e) => {
          setDismissed(null);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setDismissed(keyQueryId);
          onBlur?.(e);
        }}
      />
      {open ? (
        <div id={listId} role="listbox" aria-label="Projects" className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          {matches.map((p, i) => (
            <div
              key={p.id}
              id={optionId(i)}
              role="option"
              // Focus stays in the input; `aria-activedescendant` points at the active option.
              tabIndex={-1}
              aria-selected={i === selected}
              // Mouse down, not click: the input must keep focus, or the list closes before the click lands.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p.key);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px]", i === selected && "bg-accent text-accent-foreground")}
            >
              <span className="w-14 shrink-0">
                <span className={CHIP}>{p.key}</span>
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.status === "paused" ? <span className="shrink-0 text-[11px] text-muted-foreground">paused</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}
