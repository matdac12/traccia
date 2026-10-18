// A stand-in for "next/navigation" in jsdom: Next's `useSearchParams` follows `history.pushState`, `replaceState` and
// back/forward; this does the same over jsdom's history. Use it with `vi.mock("next/navigation", () => import("./history-navigation"))`.
import { useMemo, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};
for (const method of ["pushState", "replaceState"] as const) {
  const original = window.history[method].bind(window.history);
  window.history[method] = (...args: Parameters<History["pushState"]>) => {
    original(...args);
    notify();
  };
}
window.addEventListener("popstate", notify);
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSearchParams() {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  return useMemo(() => new URLSearchParams(search), [search]);
}
