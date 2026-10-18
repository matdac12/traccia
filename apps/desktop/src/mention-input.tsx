import {
  insertProjectKey,
  keyQueryAt,
  matchProjects,
  type ProjectOption,
} from "@traccia/shared";
import {
  type ComponentProps,
  type KeyboardEvent,
  type RefObject,
  useId,
  useLayoutEffect,
  useState,
} from "react";
import { CHIP } from "./todo-list";

type InputProps = Omit<
  ComponentProps<"input">,
  "ref" | "value" | "onChange" | "role" | "type"
>;

/**
 * A one-line input with `@` Project autocomplete, as in the Dashboard (docs/personal-space.md §7.5,
 * docs/desktop-app.md §5.2): typing `@` lists active and paused Projects, keys by prefix first, then names, up to 7;
 * ↑ ↓ move, Enter or Tab inserts `@KEY `, Esc closes the list. While the list is closed every key reaches
 * `onKeyDown` as usual. An Esc that closed the list is `preventDefault`ed, so nothing around it acts on it too.
 */
export function MentionInput({
  value,
  onValueChange,
  projects,
  inputRef,
  onKeyDown,
  onBlur,
  onFocus,
  ...props
}: InputProps & {
  value: string;
  onValueChange: (value: string) => void;
  projects: readonly ProjectOption[];
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const listId = useId();
  const [caret, setCaret] = useState(value.length);
  const [active, setActive] = useState(0);
  // Where the caret goes once a value with an inserted key has rendered.
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  // The `@` run closed with Esc (or by leaving the field); typing on reopens the list.
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
    setPendingCaret(next.caret);
  };

  useLayoutEffect(() => {
    if (pendingCaret === null) return;
    inputRef.current?.setSelectionRange(pendingCaret, pendingCaret);
    setPendingCaret(null);
  }, [pendingCaret, inputRef]);

  const track = (input: HTMLInputElement) =>
    setCaret(input.selectionStart ?? input.value.length);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (open && !event.nativeEvent.isComposing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((selected + step + matches.length) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick((matches[selected] as ProjectOption).key);
        return;
      }
      if (event.key === "Escape") {
        // Closing the list is all this Esc does: not the composer, not the window.
        event.preventDefault();
        setDismissed(keyQueryId);
        return;
      }
    }
    onKeyDown?.(event);
  };

  return (
    <span className="relative block">
      <input
        {...props}
        ref={inputRef}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(selected) : undefined}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          track(event.target);
          setActive(0);
        }}
        onSelect={(event) => track(event.currentTarget)}
        onKeyDown={handleKeyDown}
        onFocus={(event) => {
          setDismissed(null);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setDismissed(keyQueryId);
          onBlur?.(event);
        }}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Projects"
          className="absolute top-full left-0 z-10 mt-2 w-72 max-w-full overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {matches.map((p, i) => (
            <div
              key={p.id}
              id={optionId(i)}
              role="option"
              // Focus stays in the input; `aria-activedescendant` points at the active option.
              tabIndex={-1}
              aria-selected={i === selected}
              // Mouse down, not click: the input keeps the focus, or the list closes before the click lands.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(p.key);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px] ${i === selected ? "bg-accent text-accent-foreground" : ""}`}
            >
              <span className="w-14 flex-none">
                <span className={CHIP}>{p.key}</span>
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.status === "paused" && (
                <span className="flex-none text-[11px] text-muted-foreground">
                  paused
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
