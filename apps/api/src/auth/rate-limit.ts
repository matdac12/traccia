/** Fixed-window, in-memory request counter keyed by token id. */
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
    let w = this.windows.get(key);
    if (!w || now >= w.resetAt) {
      w = { resetAt: now + this.windowMs, count: 0 };
      this.windows.set(key, w);
    }
    w.count++;
    return w.count > this.limit ? Math.ceil((w.resetAt - now) / 1000) : null;
  }
}
