/**
 * Time as the Reminder scheduler sees it, injectable so tests drive it with a
 * fake clock and never sleep for real.
 */
export type Clock = {
  now(): Date;
  /** Calls `fn` once after `ms`; returns a function that cancels it. */
  setTimer(fn: () => void, ms: number): () => void;
};

export const systemClock: Clock = {
  now: () => new Date(),
  setTimer(fn, ms) {
    // Unref'd: a pending Reminder timer never keeps the process alive.
    const timer = setTimeout(fn, ms).unref();
    return () => clearTimeout(timer);
  },
};

/** Resolves after `ms` on `clock`. */
export const sleep = (clock: Clock, ms: number) =>
  new Promise<void>((resolve) => {
    clock.setTimer(resolve, ms);
  });
