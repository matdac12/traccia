import type { ReminderFailure, TodoDelivery } from "@traccia/shared";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { Db } from "../db/connection.js";
import { todos } from "../db/schema.js";
import { errorFields, type Logger } from "../logger.js";
import { todoUrl } from "../service/todos.js";
import { instantIn, todayIn } from "../time.js";
import { type Clock, sleep, systemClock } from "./clock.js";
import {
  redactToken,
  reminderText,
  type TelegramClient,
  type TelegramOutcome,
} from "./telegram.js";

// The Reminder scheduler (docs/personal-space.md §6.1, decided in TRC-147).
// It runs inside the api process, one instance, so nothing competes with it.
//
// - An exact timer sleeps until the earliest due moment (or retry), capped at
//   5 minutes: the cap is the safety check. A check also runs at startup.
// - `reschedule()` re-arms the timer after every To-do write.
// - Each check skips pending Reminders of earlier days, then sends today's
//   due ones oldest first, at least 1 s apart.
// - At-least-once: a Reminder is `sent` only after Telegram says `ok`.

const MINUTE = 60_000;
/** The longest the timer sleeps: the safety check. */
export const CHECK_CAP_MS = 5 * MINUTE;
/** Telegram's per-chat limit: about one message a second. */
export const SEND_SPACING_MS = 1000;
/** A Reminder sent later than this after its moment says `(late)`. */
export const LATE_AFTER_MS = 5 * MINUTE;
/** `/healthz` fails when the last check is older than this. */
export const STALE_AFTER_MS = 10 * MINUTE;
/** Retry delays after a transient failure: 30 s, 2 min, 10 min, then 10 min. */
const BACKOFF_MS = [30_000, 2 * MINUTE, 10 * MINUTE];
/** After a check that threw, wait this long before sending again. */
const ERROR_PAUSE_MS = 30_000;

export type ReminderHealth = {
  lastCheckAt: string | null;
  /** True when the last check (or the start, before one) is too old. */
  stale: boolean;
};

export type ReminderScheduler = {
  /** Runs the startup check, then keeps the timer armed. */
  start(): void;
  /** Cancels the timer and waits for a check in progress to end. */
  stop(): Promise<void>;
  /** Re-arms the timer from the database; call after every To-do write. */
  reschedule(): void;
  /** `GET /v1/todos/delivery` (§6.4). */
  delivery(): TodoDelivery;
  /** For `/healthz`. */
  health(): ReminderHealth;
};

type Row = typeof todos.$inferSelect;

/** A pending Reminder the scheduler may act on: open, not deleted. */
const pendingLive = and(
  eq(todos.reminderStatus, "pending"),
  eq(todos.state, "open"),
  isNull(todos.deletedAt),
);

/** The day after `day` (`YYYY-MM-DD`). */
const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);

/** What the delivery state says before any send (§6.4). */
export const initialDelivery = (configured: boolean): TodoDelivery =>
  configured ? { ok: true } : { ok: false, reason: "not_configured" };

export function createReminderScheduler(options: {
  db: Db;
  ownerTimezone: string;
  /** `BASE_URL`, for the To-do link in each message. */
  baseUrl: string;
  /** Unset when `TELEGRAM_*` is not configured: checks run, nothing is sent. */
  telegram: TelegramClient | undefined;
  logger: Logger;
  clock?: Clock;
}): ReminderScheduler {
  const { db, ownerTimezone: zone, telegram, logger } = options;
  const clock = options.clock ?? systemClock;

  let started = false;
  let stopped = false;
  let startedAt: Date | undefined;
  let lastCheckAt: Date | undefined;
  let cancelTimer: (() => void) | undefined;
  let running: Promise<void> | undefined;
  /** When the last message went out, for the 1 s spacing. */
  let lastSendAt = Number.NEGATIVE_INFINITY;
  /** No send or check before this instant (a 429's `retry_after`, or a failed check). */
  let notBefore = Number.NEGATIVE_INFINITY;
  let delivery = initialDelivery(telegram !== undefined);

  const momentOf = (row: Row) =>
    instantIn(zone, row.day ?? "", row.reminderTime ?? "").getTime();
  /** When a pending Reminder is next due: its retry time, else its moment. */
  const dueAt = (row: Row) =>
    row.reminderNextAttemptAt !== null
      ? Date.parse(row.reminderNextAttemptAt)
      : momentOf(row);

  /**
   * Pending Reminders whose moment was on an earlier day become `skipped`; one
   * that was already retrying a failed send has run out of its day, so it is
   * `failed` with `gave_up`, as if the API had stayed up.
   */
  function closePastDays(today: string): void {
    const pastDay = and(pendingLive, lt(todos.day, today));
    const gaveUp = db
      .update(todos)
      .set({
        reminderStatus: "failed",
        reminderFailure: "gave_up",
        reminderNextAttemptAt: null,
      })
      .where(and(pastDay, gt(todos.reminderAttempts, 0)))
      .returning({ id: todos.id })
      .all();
    const skipped = db
      .update(todos)
      .set({ reminderStatus: "skipped", reminderNextAttemptAt: null })
      .where(pastDay)
      .returning({ id: todos.id })
      .all();
    if (gaveUp.length) {
      logger.error("reminders gave up (earlier day)", {
        todoIds: gaveUp.map((r) => r.id),
      });
    }
    if (skipped.length) {
      logger.info("reminders skipped (earlier day)", {
        todoIds: skipped.map((r) => r.id),
      });
    }
  }

  /** Today's pending Reminders that are due at `now`, oldest moment first. */
  function dueToday(now: number): Row[] {
    const today = todayIn(zone, new Date(now));
    return db
      .select()
      .from(todos)
      .where(and(pendingLive, eq(todos.day, today)))
      .all()
      .filter((row) => dueAt(row) <= now)
      .sort((a, b) => momentOf(a) - momentOf(b) || a.id.localeCompare(b.id));
  }

  /** `row` as it is now, if it is still due (not closed, deleted or moved). */
  function stillDue(row: Row, now: number): Row | undefined {
    return dueToday(now).find(
      (r) =>
        r.id === row.id &&
        r.day === row.day &&
        r.reminderTime === row.reminderTime,
    );
  }

  /**
   * Writes a send's outcome (§6.3), only if the Reminder still has the moment
   * it was sent for: a Reminder re-armed meanwhile stays pending for its new
   * moment. Returns false when sending must pause (429).
   */
  function record(row: Row, outcome: TelegramOutcome, now: number): boolean {
    const update = (set: Partial<typeof todos.$inferInsert>) =>
      db
        .update(todos)
        .set(set)
        .where(
          and(
            eq(todos.id, row.id),
            eq(todos.reminderStatus, "pending"),
            eq(todos.day, row.day ?? ""),
            eq(todos.reminderTime, row.reminderTime ?? ""),
          ),
        )
        .run();
    const failed = (
      failure: ReminderFailure,
      also: Partial<typeof todos.$inferInsert> = {},
    ) =>
      update({
        ...also,
        reminderStatus: "failed",
        reminderFailure: failure,
        reminderNextAttemptAt: null,
      });
    const at = new Date(now).toISOString();

    switch (outcome.kind) {
      case "ok":
        update({
          reminderStatus: "sent",
          reminderSentAt: at,
          reminderNextAttemptAt: null,
          reminderFailure: null,
        });
        delivery = { ok: true, lastSentAt: at };
        logger.info("reminder sent", { todoId: row.id });
        return true;
      case "rate_limited":
        notBefore = now + outcome.retryAfterSeconds * 1000;
        logger.warn("reminder rate limited", {
          todoId: row.id,
          retryAfterSeconds: outcome.retryAfterSeconds,
        });
        return false;
      case "transient": {
        const attempts = row.reminderAttempts + 1;
        const retryAt =
          now + (BACKOFF_MS[attempts - 1] ?? BACKOFF_MS.at(-1) ?? 0);
        const endOfDay = instantIn(
          zone,
          nextDay(row.day ?? ""),
          "00:00",
        ).getTime();
        if (retryAt >= endOfDay) {
          failed("gave_up", { reminderAttempts: attempts });
          logger.error("reminder gave up", {
            todoId: row.id,
            attempts,
            reason: outcome.reason,
          });
        } else {
          update({
            reminderAttempts: attempts,
            reminderNextAttemptAt: new Date(retryAt).toISOString(),
          });
          logger.warn("reminder send failed, will retry", {
            todoId: row.id,
            attempts,
            retryAt: new Date(retryAt).toISOString(),
            reason: outcome.reason,
          });
        }
        return true;
      }
      case "unauthorized":
      case "forbidden": {
        const reason =
          outcome.kind === "unauthorized"
            ? "telegram_unauthorized"
            : "telegram_forbidden";
        failed(reason);
        delivery = { ...delivery, ok: false, reason };
        logger.error("reminder refused by Telegram", {
          todoId: row.id,
          failure: reason,
          reason: outcome.reason,
        });
        return true;
      }
      case "rejected":
        failed("telegram_rejected");
        logger.error("reminder refused by Telegram", {
          todoId: row.id,
          failure: "telegram_rejected",
          reason: outcome.reason,
        });
        return true;
    }
  }

  async function sendDue(client: TelegramClient): Promise<void> {
    for (const candidate of dueToday(clock.now().getTime())) {
      if (stopped || clock.now().getTime() < notBefore) return;
      const wait = lastSendAt + SEND_SPACING_MS - clock.now().getTime();
      if (wait > 0) await sleep(clock, wait);
      if (stopped) return;

      const now = clock.now().getTime();
      const row = stillDue(candidate, now);
      if (!row) continue;
      const text = reminderText({
        time: row.reminderTime ?? "",
        title: row.title,
        url: todoUrl(options.baseUrl, row.id),
        late: now - momentOf(row) > LATE_AFTER_MS,
      });
      const outcome = await client.send(text);
      lastSendAt = clock.now().getTime();
      if (!record(row, outcome, lastSendAt)) return;
    }
  }

  async function check(): Promise<void> {
    closePastDays(todayIn(zone, clock.now()));
    if (telegram && clock.now().getTime() >= notBefore) {
      await sendDue(telegram);
    }
    lastCheckAt = clock.now();
  }

  /**
   * When the timer should next fire: the next due Reminder, and at most
   * `CHECK_CAP_MS` after the last check. The cap counts from the check, not
   * from now, so a stream of writes (each re-arming) can't keep pushing the
   * safety check back. Never before `notBefore`.
   */
  function nextWake(): number {
    const since = lastCheckAt ?? startedAt ?? clock.now();
    let wake = since.getTime() + CHECK_CAP_MS;
    // Without Telegram nothing is sent, so due Reminders mustn't wake it.
    if (telegram) {
      const rows = db.select().from(todos).where(pendingLive).all();
      if (rows.length) wake = Math.min(wake, ...rows.map(dueAt));
    }
    return Math.max(wake, notBefore);
  }

  /** (Re)sets the timer. Never throws: on a database error it retries later. */
  function arm(): void {
    cancelTimer?.();
    cancelTimer = undefined;
    if (!started || stopped) return;
    const now = clock.now().getTime();
    let wake: number;
    try {
      wake = nextWake();
    } catch (err) {
      logger.error("reminder timer failed", redactFields(errorFields(err)));
      wake = now + ERROR_PAUSE_MS;
    }
    cancelTimer = clock.setTimer(run, Math.max(0, wake - now));
  }

  function run(): void {
    cancelTimer = undefined;
    if (running || stopped) return;
    running = check()
      .catch((err: unknown) => {
        notBefore = Math.max(notBefore, clock.now().getTime() + ERROR_PAUSE_MS);
        logger.error("reminder check failed", redactFields(errorFields(err)));
      })
      .finally(() => {
        running = undefined;
        arm();
      });
  }

  return {
    start() {
      if (started) return;
      started = true;
      startedAt = clock.now();
      run();
    },

    async stop() {
      stopped = true;
      cancelTimer?.();
      cancelTimer = undefined;
      await running;
    },

    reschedule() {
      // A check in progress re-arms the timer when it ends.
      if (!running) arm();
    },

    delivery: () => ({ ...delivery }),

    health() {
      const since = lastCheckAt ?? startedAt;
      return {
        lastCheckAt: lastCheckAt?.toISOString() ?? null,
        stale:
          since === undefined ||
          clock.now().getTime() - since.getTime() > STALE_AFTER_MS,
      };
    },
  };
}

/** Log fields with any `bot<token>` removed from their text. */
function redactFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [
      k,
      typeof v === "string" ? redactToken(v) : v,
    ]),
  );
}
