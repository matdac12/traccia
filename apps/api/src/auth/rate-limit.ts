/** Fixed-window, in-memory request counter keyed by token id or client IP. */
export class RateLimiter {
  private readonly windows = new Map<
    string,
    { resetAt: number; count: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  /** Counts one request; returns seconds to wait if over the limit, else null. */
  hit(key: string, now = Date.now()): number | null {
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) {
        if (now >= w.resetAt) this.windows.delete(k);
      }
    }
    let window = this.windows.get(key);
    if (!window || now >= window.resetAt) {
      window = { resetAt: now + this.windowMs, count: 0 };
      this.windows.set(key, window);
    }
    window.count++;
    return window.count > this.limit
      ? Math.ceil((window.resetAt - now) / 1000)
      : null;
  }
}
