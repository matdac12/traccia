import { vi } from "vitest";
import { createLogger } from "../../src/logger.js";
import type { Clock } from "../../src/reminders/clock.js";
import {
  createReminderScheduler,
  type ReminderScheduler,
} from "../../src/reminders/scheduler.js";
import type {
  TelegramClient,
  TelegramOutcome,
} from "../../src/reminders/telegram.js";
import { createServices } from "../../src/service/index.js";
import { createTestDb } from "../helpers/test-db.js";
import { onCleanup } from "../service/helpers.js";

/**
 * A fake clock that also fakes `Date`, so the To-do service (which reads
 * `new Date()`) and the scheduler share one time. Nothing sleeps for real:
 * `advance` fires the due timers in order and lets each one's work settle.
 * Call `vi.useFakeTimers({ toFake: ["Date"] })` first.
 */
export class FakeClock implements Clock {
  private timers: { at: number; seq: number; fn: () => void }[] = [];
  private seq = 0;

  now(): Date {
    return new Date();
  }

  setTimer(fn: () => void, ms: number): () => void {
    const timer = { at: Date.now() + Math.max(0, ms), seq: this.seq++, fn };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((t) => t !== timer);
    };
  }

  /** Moves time forward by `ms`, running every timer due on the way. */
  async advance(ms: number): Promise<void> {
    const end = Date.now() + ms;
    await settle();
    for (let fired = 0; ; fired++) {
      if (fired > 10_000) throw new Error("timer loop: the scheduler spins");
      const next = this.timers
        .filter((t) => t.at <= end)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) break;
      this.timers = this.timers.filter((t) => t !== next);
      vi.setSystemTime(Math.max(next.at, Date.now()));
      next.fn();
      await settle();
    }
    vi.setSystemTime(end);
    await settle();
  }

  /** Advances to an ISO instant. */
  advanceTo(iso: string): Promise<void> {
    return this.advance(new Date(iso).getTime() - Date.now());
  }
}

/** Lets every promise chain that waits on no timer run to its end. */
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

/**
 * A Telegram client that records each message with the instant it went out,
 * and answers from `outcomes` (then `ok`), or with `answer(text)`.
 */
export class FakeTelegram implements TelegramClient {
  sent: { text: string; at: string }[] = [];
  outcomes: TelegramOutcome[] = [];
  answer?: (text: string) => TelegramOutcome | Promise<TelegramOutcome>;

  async send(text: string): Promise<TelegramOutcome> {
    this.sent.push({ text, at: new Date().toISOString() });
    if (this.answer) return this.answer(text);
    return this.outcomes.shift() ?? { kind: "ok" };
  }

  /** The first line of each message, e.g. `⏰ 09:00 (late) Gym`. */
  get lines(): string[] {
    return this.sent.map((s) => s.text.split("\n")[0] ?? "");
  }
}

export const BASE_URL = "https://omni.example.ts.net";

/**
 * A scheduler over a fresh DB, wired to the To-do service like the API does.
 * Pass `telegram: null` for an API without Telegram configured. The scheduler
 * isn't started: call `scheduler.start()`.
 */
export function setupScheduler(
  options: { telegram?: TelegramClient | null } = {},
) {
  const { sqlite, db } = createTestDb();
  const clock = new FakeClock();
  const telegram =
    options.telegram === undefined ? new FakeTelegram() : options.telegram;
  const logs: string[] = [];
  const logger = createLogger("debug", (line) => logs.push(line));
  const scheduler: ReminderScheduler = createReminderScheduler({
    db,
    ownerTimezone: "Europe/Rome",
    baseUrl: BASE_URL,
    telegram: telegram ?? undefined,
    logger,
    clock,
  });
  const services = createServices({
    db,
    defaultIssueKey: "MAT",
    onTodosChanged: () => scheduler.reschedule(),
  });
  onCleanup(() => {
    void scheduler.stop();
    sqlite.close();
  });
  return {
    db,
    sqlite,
    clock,
    scheduler,
    services,
    logs,
    /** The default fake (meaningless when a client was passed in). */
    telegram: telegram as FakeTelegram,
  };
}
