import { RateLimiter } from "./rate-limit.js";
import type { ClientLimits } from "../service/oauth.js";
import { DEFAULT_CLIENT_LIMITS } from "../service/oauth.js";

type Window = { limit: number; windowMs: number };

export type OAuthHardening = {
  /** Per-IP request limits. */
  register: Window;
  authorize: Window;
  token: Window;
  /** Admin-secret lockout. */
  lockout: {
    /** Bad secrets from one IP within `windowMs` that lock that IP out. */
    maxFailuresPerIp: number;
    /** Bad secrets from anywhere within `windowMs` that lock everyone out. */
    maxFailuresGlobal: number;
    windowMs: number;
    /** How long a lockout lasts once triggered. */
    lockMs: number;
  };
  clients: ClientLimits;
  /** Injected so tests can use fake time instead of sleeping. */
  now: () => number;
};

export const DEFAULT_OAUTH_HARDENING: OAuthHardening = {
  register: { limit: 10, windowMs: 10 * 60_000 },
  authorize: { limit: 20, windowMs: 60_000 },
  token: { limit: 30, windowMs: 60_000 },
  lockout: {
    maxFailuresPerIp: 5,
    maxFailuresGlobal: 30,
    windowMs: 15 * 60_000,
    lockMs: 15 * 60_000,
  },
  clients: DEFAULT_CLIENT_LIMITS,
  now: Date.now,
};

export type OAuthHardeningOptions = Partial<Omit<OAuthHardening, "lockout">> & {
  lockout?: Partial<OAuthHardening["lockout"]>;
};

export function resolveHardening(
  options: OAuthHardeningOptions = {},
): OAuthHardening {
  return {
    ...DEFAULT_OAUTH_HARDENING,
    ...options,
    lockout: { ...DEFAULT_OAUTH_HARDENING.lockout, ...options.lockout },
  };
}

/** Failure counter that locks for `lockMs` once `max` failures land in a window. */
class FailureCounter {
  private count = 0;
  private windowEnds = 0;
  lockedUntil = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly lockMs: number,
  ) {}

  /** Seconds left on the lock, or null when not locked. */
  retryAfter(now: number): number | null {
    return now < this.lockedUntil
      ? Math.ceil((this.lockedUntil - now) / 1000)
      : null;
  }

  fail(now: number): void {
    if (now >= this.windowEnds) {
      this.count = 0;
      this.windowEnds = now + this.windowMs;
    }
    if (++this.count >= this.max) {
      this.lockedUntil = now + this.lockMs;
      this.count = 0;
      this.windowEnds = 0;
    }
  }

  /** True once nothing here matters any more, so the entry can be dropped. */
  idle(now: number): boolean {
    return now >= this.lockedUntil && now >= this.windowEnds;
  }
}

const SWEEP_ABOVE = 5000;

/**
 * Admin-secret lockout: a per-IP counter plus a global ceiling, so a guesser
 * spread over many IPs is slowed too. While locked, the secret is not even
 * compared, so a correct one is rejected until the lock expires.
 */
export class AdminSecretLockout {
  private readonly perIp = new Map<string, FailureCounter>();
  private readonly global: FailureCounter;

  constructor(
    private readonly config: OAuthHardening["lockout"],
    private readonly now: () => number,
  ) {
    this.global = new FailureCounter(
      config.maxFailuresGlobal,
      config.windowMs,
      config.lockMs,
    );
  }

  /** Seconds to wait if this IP (or everyone) is locked out, else null. */
  retryAfter(ip: string): number | null {
    const now = this.now();
    const waits = [
      this.perIp.get(ip)?.retryAfter(now) ?? null,
      this.global.retryAfter(now),
    ].filter((w): w is number => w !== null);
    return waits.length ? Math.max(...waits) : null;
  }

  recordFailure(ip: string): void {
    const now = this.now();
    if (this.perIp.size > SWEEP_ABOVE) {
      for (const [key, c] of this.perIp)
        if (c.idle(now)) this.perIp.delete(key);
    }
    let counter = this.perIp.get(ip);
    if (!counter) {
      counter = new FailureCounter(
        this.config.maxFailuresPerIp,
        this.config.windowMs,
        this.config.lockMs,
      );
      this.perIp.set(ip, counter);
    }
    counter.fail(now);
    this.global.fail(now);
  }

  recordSuccess(ip: string): void {
    this.perIp.delete(ip);
  }
}

export type OAuthGuards = {
  config: OAuthHardening;
  register: RateLimiter;
  authorize: RateLimiter;
  token: RateLimiter;
  lockout: AdminSecretLockout;
};

export function createOAuthGuards(
  options?: OAuthHardeningOptions,
): OAuthGuards {
  const config = resolveHardening(options);
  return {
    config,
    register: new RateLimiter(config.register.limit, config.register.windowMs),
    authorize: new RateLimiter(
      config.authorize.limit,
      config.authorize.windowMs,
    ),
    token: new RateLimiter(config.token.limit, config.token.windowMs),
    lockout: new AdminSecretLockout(config.lockout, config.now),
  };
}
