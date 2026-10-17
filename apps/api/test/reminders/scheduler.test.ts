import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todos } from "../../src/db/schema.js";
import {
  createTelegramClient,
  type TelegramClient,
} from "../../src/reminders/telegram.js";
import { createLogger } from "../../src/logger.js";
import { createReminderScheduler } from "../../src/reminders/scheduler.js";
import { BASE_URL, setupScheduler } from "./harness.js";

// Europe/Rome is UTC+2 on these days: 10:00Z is 12:00 in Rome.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

const reminderAt = (
  s: ReturnType<typeof setupScheduler>,
  time: string,
  title = `At ${time}`,
  day = "2026-10-17",
) => s.services.todos.create("you", "t", { title, day, time });

describe("the exact timer", () => {
  it("wakes at the earliest due moment, not at the 5-minute check", async () => {
    const s = setupScheduler();
    reminderAt(s, "12:30");
    reminderAt(s, "12:07");
    reminderAt(s, "12:20");
    s.scheduler.start();

    await s.clock.advanceTo("2026-10-17T10:06:59.999Z");
    expect(s.telegram.sent).toEqual([]);
    await s.clock.advanceTo("2026-10-17T10:07:00.000Z");
    expect(s.telegram.sent).toEqual([
      {
        text: expect.stringMatching(/^⏰ 12:07 At 12:07\n/),
        at: "2026-10-17T10:07:00.000Z",
      },
    ]);
    await s.clock.advanceTo("2026-10-17T10:30:00.000Z");
    expect(s.telegram.sent.map((m) => [m.text.split("\n")[0], m.at])).toEqual([
      ["⏰ 12:07 At 12:07", "2026-10-17T10:07:00.000Z"],
      ["⏰ 12:20 At 12:20", "2026-10-17T10:20:00.000Z"],
      ["⏰ 12:30 At 12:30", "2026-10-17T10:30:00.000Z"],
    ]);
  });

  it("wakes earlier when a write brings a Reminder forward", async () => {
    const s = setupScheduler();
    const todo = reminderAt(s, "12:30");
    s.scheduler.start();
    await s.clock.advance(60_000);
    s.services.todos.update(todo.id, { time: "12:02" });
    await s.clock.advanceTo("2026-10-17T10:02:00.000Z");
    expect(s.telegram.sent.map((m) => m.at)).toEqual([
      "2026-10-17T10:02:00.000Z",
    ]);
  });
});

describe("the safety check", () => {
  it("runs at startup and then every 5 minutes when nothing is due", async () => {
    const s = setupScheduler();
    reminderAt(s, "09:00", "Tomorrow", "2026-10-18");
    expect(s.scheduler.health().lastCheckAt).toBeNull();
    s.scheduler.start();
    await s.clock.advance(0);
    expect(s.scheduler.health().lastCheckAt).toBe("2026-10-17T10:00:00.000Z");
    await s.clock.advance(5 * 60_000 - 1);
    expect(s.scheduler.health().lastCheckAt).toBe("2026-10-17T10:00:00.000Z");
    await s.clock.advance(1);
    expect(s.scheduler.health().lastCheckAt).toBe("2026-10-17T10:05:00.000Z");
    await s.clock.advance(5 * 60_000);
    expect(s.scheduler.health().lastCheckAt).toBe("2026-10-17T10:10:00.000Z");
    expect(s.telegram.sent).toEqual([]);
  });

  it("still runs every 5 minutes while To-do writes keep coming", async () => {
    const s = setupScheduler();
    const todo = s.services.todos.create("you", "t", { title: "Busy" });
    s.scheduler.start();
    await s.clock.advance(0);
    for (let i = 1; i <= 6; i++) {
      await s.clock.advance(2 * 60_000);
      s.services.todos.update(todo.id, { title: `Busy ${i}` });
    }
    // 12 minutes of writes every 2 minutes: checks at 10:05 and 10:10.
    expect(s.scheduler.health()).toEqual({
      lastCheckAt: "2026-10-17T10:10:00.000Z",
      stale: false,
    });
  });

  it("keeps working when re-arming after a write fails", async () => {
    const s = setupScheduler();
    s.scheduler.start();
    await s.clock.advance(0);
    s.sqlite.exec("ALTER TABLE todos RENAME TO todos_gone");
    expect(() => s.scheduler.reschedule()).not.toThrow();
    expect(s.logs.some((l) => l.includes("reminder timer failed"))).toBe(true);
    s.sqlite.exec("ALTER TABLE todos_gone RENAME TO todos");
  });

  it("waits 30 s between checks that fail, rather than spinning", async () => {
    const s = setupScheduler();
    s.scheduler.start();
    await s.clock.advance(0);
    s.sqlite.exec("ALTER TABLE todos RENAME TO todos_gone");
    await s.clock.advance(10 * 60_000);
    const failures = s.logs.filter((l) => l.includes("reminder check failed"));
    // The 10:05 check, then every 30 s until 10:10.
    expect(failures).toHaveLength(11);
    expect(s.scheduler.health().stale).toBe(false);
    await s.clock.advance(60_000);
    expect(s.scheduler.health().stale).toBe(true);
    s.sqlite.exec("ALTER TABLE todos_gone RENAME TO todos");
  });

  it("sends a Reminder the timer missed at the next check", async () => {
    const s = setupScheduler();
    s.scheduler.start();
    await s.clock.advance(0);
    // Written straight to the database, without reschedule(): the timer
    // doesn't know about it.
    s.db
      .insert(todos)
      .values({
        id: "01MISSED",
        title: "Missed by the timer",
        day: "2026-10-17",
        reminderTime: "12:01",
        reminderStatus: "pending",
        createdBy: "you",
        createdByToken: "t",
        createdAt: "2026-10-17T10:00:00.000Z",
        updatedAt: "2026-10-17T10:00:00.000Z",
      })
      .run();
    await s.clock.advanceTo("2026-10-17T10:04:59.000Z");
    expect(s.telegram.sent).toEqual([]);
    await s.clock.advanceTo("2026-10-17T10:05:00.000Z");
    expect(s.telegram.lines).toEqual(["⏰ 12:01 Missed by the timer"]);
  });
});

describe("the startup check", () => {
  it("sends today's missed Reminders, late after 5 minutes, and skips yesterday's", async () => {
    const s = setupScheduler();
    // Created the day before, while the API was still up.
    vi.setSystemTime(new Date("2026-10-16T05:00:00.000Z"));
    const yesterday = reminderAt(s, "09:00", "Yesterday", "2026-10-16");
    const early = reminderAt(s, "08:00", "Early today");
    const recent = reminderAt(s, "11:57", "Three minutes ago");
    const exact = reminderAt(s, "11:55", "Five minutes ago");

    // The API comes back at 12:00 in Rome.
    vi.setSystemTime(new Date("2026-10-17T10:00:00.000Z"));
    s.scheduler.start();
    await s.clock.advance(10_000);

    // 11:55 goes out at 12:00:01, 5 min 1 s after its moment: late.
    expect(s.telegram.lines).toEqual([
      "⏰ 08:00 (late) Early today",
      "⏰ 11:55 (late) Five minutes ago",
      "⏰ 11:57 Three minutes ago",
    ]);
    const reminder = (id: string) => s.services.todos.get(id).reminder;
    expect(reminder(yesterday.id)).toMatchObject({ status: "skipped" });
    expect(reminder(early.id)).toMatchObject({
      status: "sent",
      sentAt: "2026-10-17T10:00:00.000Z",
    });
    expect(reminder(exact.id)).toMatchObject({
      status: "sent",
      sentAt: "2026-10-17T10:00:01.000Z",
    });
    expect(reminder(recent.id)).toMatchObject({ status: "sent" });
  });

  it("isn't late at exactly 5 minutes", async () => {
    const s = setupScheduler();
    vi.setSystemTime(new Date("2026-10-17T05:00:00.000Z"));
    reminderAt(s, "11:55", "On the edge");
    vi.setSystemTime(new Date("2026-10-17T10:00:00.000Z"));
    s.scheduler.start();
    await s.clock.advance(0);
    expect(s.telegram.lines).toEqual(["⏰ 11:55 On the edge"]);
  });

  it("links each message to its To-do", async () => {
    const s = setupScheduler();
    const todo = reminderAt(s, "12:01", "Call the bank @CRM");
    s.scheduler.start();
    await s.clock.advance(60_000);
    expect(s.telegram.sent.map((m) => m.text)).toEqual([
      `⏰ 12:01 Call the bank @CRM\nhttps://omni.example.ts.net/personal?todo=${todo.id}`,
    ]);
  });
});

describe("spacing", () => {
  it("sends Reminders due at the same moment 1 s apart", async () => {
    const s = setupScheduler();
    reminderAt(s, "12:10", "C");
    reminderAt(s, "12:05", "A");
    reminderAt(s, "12:05", "B");
    s.scheduler.start();
    await s.clock.advanceTo("2026-10-17T10:10:00.000Z");
    expect(s.telegram.sent.map((m) => m.at)).toEqual([
      "2026-10-17T10:05:00.000Z",
      "2026-10-17T10:05:01.000Z",
      "2026-10-17T10:10:00.000Z",
    ]);
    expect(s.telegram.lines.slice(0, 2).sort()).toEqual([
      "⏰ 12:05 A",
      "⏰ 12:05 B",
    ]);
  });

  it("keeps 1 s between a catch-up burst's messages, oldest first", async () => {
    const s = setupScheduler();
    vi.setSystemTime(new Date("2026-10-17T05:00:00.000Z"));
    for (const t of ["08:03", "08:01", "08:00", "08:02"]) reminderAt(s, t);
    vi.setSystemTime(new Date("2026-10-17T10:00:00.000Z"));
    s.scheduler.start();
    await s.clock.advance(60_000);
    expect(s.telegram.sent.map((m) => [m.text.split("\n")[0], m.at])).toEqual([
      ["⏰ 08:00 (late) At 08:00", "2026-10-17T10:00:00.000Z"],
      ["⏰ 08:01 (late) At 08:01", "2026-10-17T10:00:01.000Z"],
      ["⏰ 08:02 (late) At 08:02", "2026-10-17T10:00:02.000Z"],
      ["⏰ 08:03 (late) At 08:03", "2026-10-17T10:00:03.000Z"],
    ]);
  });
});

describe("Telegram outcomes (§6.3)", () => {
  it("ok: marks the Reminder sent", async () => {
    const s = setupScheduler();
    const todo = reminderAt(s, "12:01");
    s.scheduler.start();
    await s.clock.advance(60_000);
    expect(s.services.todos.get(todo.id).reminder).toEqual({
      time: "12:01",
      status: "sent",
      failure: null,
      sentAt: "2026-10-17T10:01:00.000Z",
    });
  });

  it("429: waits retry_after, then resends", async () => {
    const s = setupScheduler();
    const todo = reminderAt(s, "12:01", "A");
    reminderAt(s, "12:01", "B");
    s.telegram.outcomes = [{ kind: "rate_limited", retryAfterSeconds: 7 }];
    s.scheduler.start();
    await s.clock.advanceTo("2026-10-17T10:01:06.999Z");
    expect(s.telegram.sent).toHaveLength(1);
    expect(s.services.todos.get(todo.id).reminder?.status).toBe("pending");
    await s.clock.advanceTo("2026-10-17T10:01:10.000Z");
    expect(s.telegram.sent.map((m) => [m.text.split("\n")[0], m.at])).toEqual([
      ["⏰ 12:01 A", "2026-10-17T10:01:00.000Z"],
      ["⏰ 12:01 A", "2026-10-17T10:01:07.000Z"],
      ["⏰ 12:01 B", "2026-10-17T10:01:08.000Z"],
    ]);
    expect(s.services.todos.get(todo.id).reminder?.status).toBe("sent");
  });

  it("5xx, network error, timeout: retries after 30 s, 2 min, 10 min, then every 10 min", async () => {
    const s = setupScheduler();
    const todo = reminderAt(s, "12:01");
    s.telegram.outcomes = Array.from({ length: 5 }, () => ({
      kind: "transient" as const,
      reason: "HTTP 502",
    }));
    s.scheduler.start();
    await s.clock.advanceTo("2026-10-17T10:01:00.000Z");
    expect(s.services.todos.get(todo.id).reminder).toMatchObject({
      status: "pending",
      failure: null,
    });
    await s.clock.advanceTo("2026-10-17T11:00:00.000Z");
    expect(s.telegram.sent.map((m) => m.at)).toEqual([
      "2026-10-17T10:01:00.000Z",
      "2026-10-17T10:01:30.000Z", // +30 s
      "2026-10-17T10:03:30.000Z", // +2 min
      "2026-10-17T10:13:30.000Z", // +10 min
      "2026-10-17T10:23:30.000Z", // +10 min
      "2026-10-17T10:33:30.000Z", // +10 min: ok
    ]);
    expect(s.services.todos.get(todo.id).reminder).toMatchObject({
      status: "sent",
      sentAt: "2026-10-17T10:33:30.000Z",
    });
  });

  it("gives up at the end of the moment's day", async () => {
    const s = setupScheduler();
    vi.setSystemTime(new Date("2026-10-17T21:00:00.000Z")); // 23:00 in Rome
    const todo = reminderAt(s, "23:30");
    s.telegram.answer = () => ({ kind: "transient", reason: "timeout" });
    s.scheduler.start();
    await s.clock.advanceTo("2026-10-17T23:00:00.000Z"); // 01:00 next day
    expect(s.telegram.sent.map((m) => m.at)).toEqual([
      "2026-10-17T21:30:00.000Z", // 23:30
      "2026-10-17T21:30:30.000Z",
      "2026-10-17T21:32:30.000Z",
      "2026-10-17T21:42:30.000Z",
      "2026-10-17T21:52:30.000Z", // 23:52:30; the next would be past midnight
    ]);
    expect(s.services.todos.get(todo.id).reminder).toMatchObject({
      status: "failed",
      failure: "gave_up",
    });
    expect(s.logs.some((l) => l.includes("reminder gave up"))).toBe(true);
  });

  it("gives up, rather than skipping, a retry the API couldn't finish before midnight", async () => {
    const s = setupScheduler();
    vi.setSystemTime(new Date("2026-10-17T21:00:00.000Z")); // 23:00 in Rome
    const todo = reminderAt(s, "23:58");
    s.telegram.outcomes = [{ kind: "transient", reason: "HTTP 502" }];
    s.scheduler.start();
    await s.clock.advanceTo("2026-10-17T21:58:00.000Z");
    expect(s.services.todos.get(todo.id).reminder?.status).toBe("pending");
    // The API is down from 23:58:10 until 00:30, past the retry at 23:58:30.
    await s.scheduler.stop();
    vi.setSystemTime(new Date("2026-10-17T22:30:00.000Z"));
    const restarted = createReminderScheduler({
      db: s.db,
      ownerTimezone: "Europe/Rome",
      baseUrl: BASE_URL,
      telegram: s.telegram,
      logger: createLogger("silent"),
      clock: s.clock,
    });
    restarted.start();
    await s.clock.advance(0);
    await restarted.stop();
    expect(s.telegram.sent).toHaveLength(1);
    expect(s.services.todos.get(todo.id).reminder).toMatchObject({
      status: "failed",
      failure: "gave_up",
    });
  });

  it.each([
    ["unauthorized", "telegram_unauthorized"],
    ["forbidden", "telegram_forbidden"],
    ["rejected", "telegram_rejected"],
  ] as const)("%s: fails at once with %s", async (kind, failure) => {
    const s = setupScheduler();
    const todo = reminderAt(s, "12:01");
    s.telegram.outcomes = [{ kind, reason: `HTTP ${kind}` }];
    s.scheduler.start();
    await s.clock.advanceTo("2026-10-17T11:00:00.000Z");
    expect(s.telegram.sent).toHaveLength(1);
    expect(s.services.todos.get(todo.id).reminder).toMatchObject({
      status: "failed",
      failure,
      sentAt: null,
    });
  });
});

describe("re-arming", () => {
  it("sends a sent Reminder again at its new moment", async () => {
    const s = setupScheduler();
    const todo = reminderAt(s, "12:01", "Snooze me");
    s.scheduler.start();
    await s.clock.advanceTo("2026-10-17T10:02:00.000Z");
    expect(s.services.todos.get(todo.id).reminder?.status).toBe("sent");

    s.services.todos.update(todo.id, { time: "12:20" });
    expect(s.services.todos.get(todo.id).reminder?.status).toBe("pending");
    await s.clock.advanceTo("2026-10-17T10:20:00.000Z");
    expect(s.telegram.sent.map((m) => [m.text.split("\n")[0], m.at])).toEqual([
      ["⏰ 12:01 Snooze me", "2026-10-17T10:01:00.000Z"],
      ["⏰ 12:20 Snooze me", "2026-10-17T10:20:00.000Z"],
    ]);
  });

  it("keeps a Reminder re-armed while its send was in flight pending", async () => {
    const s = setupScheduler();
    const todo = reminderAt(s, "12:01", "Moved mid-send");
    s.telegram.answer = () => {
      s.services.todos.update(todo.id, { time: "12:30" });
      return { kind: "ok" };
    };
    s.scheduler.start();
    await s.clock.advanceTo("2026-10-17T10:02:00.000Z");
    expect(s.services.todos.get(todo.id).reminder).toMatchObject({
      time: "12:30",
      status: "pending",
    });
  });
});

describe("closed and deleted To-dos", () => {
  it("never send", async () => {
    const s = setupScheduler();
    const done = reminderAt(s, "12:01", "Done");
    const dropped = reminderAt(s, "12:01", "Dropped");
    const deleted = reminderAt(s, "12:01", "Deleted");
    const parent = s.services.todos.create("you", "t", { title: "Parent" });
    const child = s.services.todos.create("you", "t", {
      title: "Sub-to-do of a deleted parent",
      parentId: parent.id,
      day: "2026-10-17",
      time: "12:01",
    });
    s.scheduler.start();
    s.services.todos.update(done.id, { state: "done" });
    s.services.todos.update(dropped.id, { state: "dropped" });
    await s.services.trash.delete("you", "todo", deleted.id);
    await s.services.trash.delete("you", "todo", parent.id);
    await s.clock.advanceTo("2026-10-17T11:00:00.000Z");
    expect(s.telegram.sent).toEqual([]);
    expect(s.services.todos.get(child.id).deleted).toBe(true);
  });

  it("aren't sent when closed while a burst waits its turn", async () => {
    const s = setupScheduler();
    reminderAt(s, "12:01", "A");
    const b = reminderAt(s, "12:01", "B");
    s.telegram.answer = (text) => {
      // While A goes out, B is closed from the dashboard.
      if (text.includes(" A\n")) {
        s.services.todos.update(b.id, { state: "done" });
      }
      return { kind: "ok" };
    };
    s.scheduler.start();
    await s.clock.advanceTo("2026-10-17T10:05:00.000Z");
    expect(s.telegram.lines).toEqual(["⏰ 12:01 A"]);
  });
});

describe("restore", () => {
  it("sends a Reminder that passed earlier today at once, late", async () => {
    const s = setupScheduler();
    const todo = reminderAt(s, "12:01", "Restored");
    await s.services.trash.delete("you", "todo", todo.id);
    s.scheduler.start();
    await s.clock.advanceTo("2026-10-17T10:20:00.000Z");
    expect(s.telegram.sent).toEqual([]);

    s.services.trash.restore("you", "todo", todo.id);
    await s.clock.advance(0);
    expect(s.telegram.sent).toEqual([
      {
        text: expect.stringMatching(/^⏰ 12:01 \(late\) Restored\n/),
        at: "2026-10-17T10:20:00.000Z",
      },
    ]);
  });

  it("skips a Reminder that passed on an earlier day", async () => {
    const s = setupScheduler();
    vi.setSystemTime(new Date("2026-10-16T05:00:00.000Z"));
    const todo = reminderAt(s, "09:00", "From yesterday", "2026-10-16");
    await s.services.trash.delete("you", "todo", todo.id);
    vi.setSystemTime(new Date("2026-10-17T10:00:00.000Z"));
    s.scheduler.start();
    await s.clock.advance(1000);

    s.services.trash.restore("you", "todo", todo.id);
    await s.clock.advance(0);
    expect(s.telegram.sent).toEqual([]);
    expect(s.services.todos.get(todo.id).reminder?.status).toBe("skipped");
  });
});

describe("delivery state (§6.4)", () => {
  it("is not_configured without Telegram, and nothing is sent", async () => {
    const s = setupScheduler({ telegram: null });
    const todo = reminderAt(s, "12:01");
    s.scheduler.start();
    expect(s.scheduler.delivery()).toEqual({
      ok: false,
      reason: "not_configured",
    });
    await s.clock.advanceTo("2026-10-17T10:30:00.000Z");
    expect(s.services.todos.get(todo.id).reminder?.status).toBe("pending");
    // The checks still run (past days are still skipped), every 5 minutes.
    expect(s.scheduler.health()).toEqual({
      lastCheckAt: "2026-10-17T10:30:00.000Z",
      stale: false,
    });
  });

  it("is ok after start, reports a permanent failure, and recovers on the next success", async () => {
    const s = setupScheduler();
    reminderAt(s, "12:01");
    reminderAt(s, "12:02");
    reminderAt(s, "12:03");
    s.telegram.outcomes = [
      { kind: "ok" },
      { kind: "forbidden", reason: "HTTP 403" },
      { kind: "unauthorized", reason: "HTTP 401" },
    ];
    s.scheduler.start();
    expect(s.scheduler.delivery()).toEqual({ ok: true });

    await s.clock.advanceTo("2026-10-17T10:01:00.000Z");
    expect(s.scheduler.delivery()).toEqual({
      ok: true,
      lastSentAt: "2026-10-17T10:01:00.000Z",
    });
    await s.clock.advanceTo("2026-10-17T10:02:00.000Z");
    expect(s.scheduler.delivery()).toEqual({
      ok: false,
      reason: "telegram_forbidden",
      lastSentAt: "2026-10-17T10:01:00.000Z",
    });
    await s.clock.advanceTo("2026-10-17T10:03:00.000Z");
    expect(s.scheduler.delivery()).toEqual({
      ok: false,
      reason: "telegram_unauthorized",
      lastSentAt: "2026-10-17T10:01:00.000Z",
    });

    reminderAt(s, "12:10");
    await s.clock.advanceTo("2026-10-17T10:10:00.000Z");
    expect(s.scheduler.delivery()).toEqual({
      ok: true,
      lastSentAt: "2026-10-17T10:10:00.000Z",
    });
  });

  it("isn't changed by a rejected or transient send", async () => {
    const s = setupScheduler();
    reminderAt(s, "12:01");
    reminderAt(s, "12:02");
    s.telegram.outcomes = [
      { kind: "rejected", reason: "HTTP 400" },
      { kind: "transient", reason: "HTTP 500" },
    ];
    s.scheduler.start();
    await s.clock.advanceTo("2026-10-17T10:02:00.000Z");
    expect(s.telegram.sent).toHaveLength(2);
    expect(s.scheduler.delivery()).toEqual({ ok: true });
  });
});

describe("health", () => {
  it("goes stale when a check stalls for more than 10 minutes", async () => {
    const s = setupScheduler();
    reminderAt(s, "12:01");
    s.telegram.answer = () => new Promise(() => {}); // never answers
    s.scheduler.start();
    await s.clock.advance(0);
    expect(s.scheduler.health()).toEqual({
      lastCheckAt: "2026-10-17T10:00:00.000Z",
      stale: false,
    });
    await s.clock.advanceTo("2026-10-17T10:10:00.000Z");
    expect(s.scheduler.health().stale).toBe(false);
    await s.clock.advanceTo("2026-10-17T10:10:00.001Z");
    expect(s.scheduler.health()).toEqual({
      lastCheckAt: "2026-10-17T10:00:00.000Z",
      stale: true,
    });
  });
});

describe("logs", () => {
  it("never contain the bot token, even from a thrown error", async () => {
    const token = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const failing: TelegramClient = {
      // A client bug: it throws instead of returning an outcome.
      send: () => Promise.reject(new Error(`request to ${url} failed`)),
    };
    const s = setupScheduler({ telegram: failing });
    reminderAt(s, "12:01");
    s.scheduler.start();
    await s.clock.advance(2 * 60_000);
    const errors = s.logs.filter((l) => l.includes("reminder check failed"));
    expect(errors.length).toBeGreaterThan(0);
    for (const line of s.logs) {
      expect(line).not.toContain(token);
      expect(line).not.toContain("AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw");
    }
    expect(errors[0]).toContain("bot<redacted>");
  });

  it("keeps the token out of a real client's failure logs", async () => {
    const token = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
    const client = createTelegramClient({
      botToken: token,
      chatId: "42",
      fetch: (input) =>
        Promise.reject(
          new TypeError("fetch failed", {
            cause: new Error(`connect ECONNREFUSED ${String(input)}`),
          }),
        ),
    });
    const s = setupScheduler({ telegram: client });
    reminderAt(s, "12:01");
    s.scheduler.start();
    await s.clock.advance(2 * 60_000);
    expect(s.logs.some((l) => l.includes("will retry"))).toBe(true);
    expect(s.logs.join("\n")).not.toContain(token);
  });
});

describe("stop", () => {
  it("cancels the timer", async () => {
    const s = setupScheduler();
    reminderAt(s, "12:01");
    s.scheduler.start();
    await s.clock.advance(0);
    await s.scheduler.stop();
    s.scheduler.reschedule();
    await s.clock.advanceTo("2026-10-17T11:00:00.000Z");
    expect(s.telegram.sent).toEqual([]);
    expect(s.scheduler.health().lastCheckAt).toBe("2026-10-17T10:00:00.000Z");
  });

  it("does nothing before start", async () => {
    const s = setupScheduler();
    reminderAt(s, "12:01");
    await s.clock.advanceTo("2026-10-17T11:00:00.000Z");
    expect(s.telegram.sent).toEqual([]);
    expect(s.scheduler.health().lastCheckAt).toBeNull();
  });
});
