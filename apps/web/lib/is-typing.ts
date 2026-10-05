/** True when a key event came from a text field, where single-key and Cmd/Ctrl shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/**
 * True when a global key shortcut must not fire: the event was already handled, came from a text field, or a Radix
 * dialog/menu is open (those are modal, so do not act on top of them).
 */
export function shortcutBlocked(e: KeyboardEvent): boolean {
  return e.defaultPrevented || isTyping(e.target) || !!document.querySelector("[role=dialog],[role=menu]");
}
