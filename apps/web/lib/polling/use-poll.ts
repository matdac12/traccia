"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Between polls on a healthy connection. Spec 12.2: about 10-15 s. */
export const POLL_INTERVAL_MS = 12_000;
/** The longest wait after repeated failures. */
export const POLL_MAX_BACKOFF_MS = 120_000;
/** A focus / visibility / online event within this window of the last poll does not poll again. */
export const POLL_MIN_GAP_MS = 2_000;

export type PollOptions = {
  intervalMs?: number;
  maxBackoffMs?: number;
  minGapMs?: number;
  /** False pauses polling entirely (for example while an error page is shown). */
  enabled?: boolean;
};

/** Wait before the next poll after `failures` failures in a row: the interval, doubled each time, capped. */
export function nextDelay(failures: number, intervalMs: number, maxBackoffMs: number) {
  return Math.min(intervalMs * 2 ** failures, Math.max(maxBackoffMs, intervalMs));
}

/**
 * Runs `tick` every interval while the tab is visible. Hidden tab: no timer, no requests. Back to
 * visible, window focus and network reconnect: poll now (rate-limited by `minGapMs`; reconnect also
 * forgets the backoff). A rejected `tick` backs the interval off; one success resets it. Polls never overlap.
 */
export function usePoll(tick: () => Promise<void>, { intervalMs = POLL_INTERVAL_MS, maxBackoffMs = POLL_MAX_BACKOFF_MS, minGapMs = POLL_MIN_GAP_MS, enabled = true }: PollOptions = {}) {
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [failures, setFailures] = useState(0);
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let running = false;
    let failed = 0;
    let lastRun = -Infinity;

    const schedule = () => {
      clearTimeout(timer);
      if (stopped || document.hidden) return;
      timer = setTimeout(run, nextDelay(failed, intervalMs, maxBackoffMs));
    };
    const run = async () => {
      clearTimeout(timer);
      if (stopped || running || document.hidden) return;
      running = true;
      lastRun = Date.now();
      try {
        await tickRef.current();
        failed = 0;
        if (!stopped) setLastUpdated(Date.now());
      } catch {
        failed++;
      } finally {
        running = false;
        if (!stopped) {
          setFailures(failed);
          schedule();
        }
      }
    };
    /** Visibility / focus / online: poll now unless one just ran. */
    const revalidate = () => {
      if (document.hidden) return clearTimeout(timer);
      if (Date.now() - lastRun >= minGapMs) void run();
      else if (!running) schedule();
    };
    const onOnline = () => {
      failed = 0;
      revalidate();
    };
    refreshRef.current = () => void run();

    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    window.addEventListener("online", onOnline);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, intervalMs, maxBackoffMs, minGapMs]);

  return { lastUpdated, failures, refresh };
}
