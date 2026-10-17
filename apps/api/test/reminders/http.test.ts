import { todoDeliverySchema } from "@traccia/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createLogger } from "../../src/logger.js";
import { createReminderScheduler } from "../../src/reminders/scheduler.js";
import { createToken } from "../../src/service/tokens.js";
import { createTestApp } from "../helpers/test-app.js";
import { createTestDb } from "../helpers/test-db.js";
import { onCleanup } from "../service/helpers.js";
import { FakeClock, FakeTelegram } from "./harness.js";

// /healthz and GET /v1/todos/delivery (§6.4) over HTTP, with the scheduler
// in the app container as main.ts puts it.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

const TELEGRAM = {
  TELEGRAM_BOT_TOKEN: "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw",
  TELEGRAM_CHAT_ID: "42",
};

function setup(env: Record<string, string> = TELEGRAM) {
  const config = loadConfig({ BASE_URL: "http://localhost:8787", ...env });
  const { db, sqlite } = createTestDb();
  const clock = new FakeClock();
  const telegram = new FakeTelegram();
  const logger = createLogger("silent");
  const reminders = createReminderScheduler({
    db,
    ownerTimezone: config.ownerTimezone,
    baseUrl: config.baseUrl,
    telegram: config.telegram ? telegram : undefined,
    logger,
    clock,
  });
  const app = createApp({ config, db, logger, reminders });
  onCleanup(() => {
    void reminders.stop();
    sqlite.close();
  });
  const todosToken = createToken(db, {
    name: "parla",
    actor: "you",
    scope: "todos",
  }).token;
  const get = (path: string) =>
    app.request(path, { headers: { Authorization: `Bearer ${todosToken}` } });
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${todosToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const del = (path: string) =>
    app.request(path, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${todosToken}` },
    });
  return { app, clock, telegram, reminders, get, post, del };
}

describe("GET /healthz", () => {
  it("adds reminders.lastCheckAt", async () => {
    const s = setup();
    s.reminders.start();
    await s.clock.advance(0);
    const res = await s.app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      reminders: { lastCheckAt: "2026-10-17T10:00:00.000Z" },
    });
  });

  it("answers 503 when the last check is more than 10 minutes old", async () => {
    const s = setup();
    s.reminders.start();
    await s.clock.advance(0);
    // The checks stall: time moves on but no timer fires.
    vi.setSystemTime(new Date("2026-10-17T10:10:00.001Z"));
    const res = await s.app.request("/healthz");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      reminders: { lastCheckAt: "2026-10-17T10:00:00.000Z" },
    });
  });

  it("stays healthy while the 5-minute checks keep running", async () => {
    const s = setup();
    s.reminders.start();
    await s.clock.advance(60 * 60_000);
    const res = await s.app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      reminders: { lastCheckAt: "2026-10-17T11:00:00.000Z" },
    });
  });

  it("is still { ok: true } in an app without a scheduler", async () => {
    const { app } = createTestApp();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /v1/todos/delivery", () => {
  it("is ok after start, for a todos-scoped token", async () => {
    const s = setup();
    s.reminders.start();
    const res = await s.get("/v1/todos/delivery");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(todoDeliverySchema.parse(body)).toEqual({ ok: true });
  });

  it("reports not_configured without Telegram", async () => {
    const s = setup({});
    s.reminders.start();
    const res = await s.get("/v1/todos/delivery");
    expect(await res.json()).toEqual({ ok: false, reason: "not_configured" });
  });

  it.each([
    ["unauthorized", "telegram_unauthorized"],
    ["forbidden", "telegram_forbidden"],
  ] as const)("reports %s after Telegram refuses", async (kind, reason) => {
    const s = setup();
    s.telegram.outcomes = [{ kind, reason: "HTTP 4xx" }];
    s.reminders.start();
    const created = await s.post("/v1/todos", {
      title: "Call the bank",
      time: "12:01",
    });
    expect(created.status).toBe(201);
    await s.clock.advanceTo("2026-10-17T10:01:00.000Z");
    expect(await (await s.get("/v1/todos/delivery")).json()).toEqual({
      ok: false,
      reason,
    });
  });

  it("reports lastSentAt after a send, triggered by a POST", async () => {
    const s = setup();
    s.reminders.start();
    await s.clock.advance(0);
    // The POST reschedules the timer to 12:01, before the 12:05 check.
    await s.post("/v1/todos", { title: "Call the bank", time: "12:01" });
    await s.clock.advanceTo("2026-10-17T10:01:00.000Z");
    expect(s.telegram.lines).toEqual(["⏰ 12:01 Call the bank"]);
    expect(await (await s.get("/v1/todos/delivery")).json()).toEqual({
      ok: true,
      lastSentAt: "2026-10-17T10:01:00.000Z",
    });
  });

  it("reports from the config in an app without a scheduler", async () => {
    for (const [env, expected] of [
      [{}, { ok: false, reason: "not_configured" }],
      [TELEGRAM, { ok: true }],
    ] as const) {
      const t = createTestApp(env);
      const token = createToken(t.db, { name: "y", actor: "you" }).token;
      const res = await t.app.request("/v1/todos/delivery", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(await res.json()).toEqual(expected);
    }
  });

  it("needs a token", async () => {
    const s = setup();
    expect((await s.app.request("/v1/todos/delivery")).status).toBe(401);
  });
});

describe("REST delete and restore", () => {
  it("reschedule: a deleted To-do never sends, and comes back late on restore", async () => {
    const s = setup();
    s.reminders.start();
    await s.clock.advance(0);
    const created = await s.post("/v1/todos", { title: "Back", time: "12:01" });
    const { id } = (await created.json()) as { id: string };
    expect((await s.del(`/v1/todos/${id}`)).status).toBe(200);
    await s.clock.advanceTo("2026-10-17T10:20:00.000Z");
    expect(s.telegram.sent).toEqual([]);

    const restored = await s.post("/v1/restore", { type: "todo", id });
    expect(restored.status).toBe(200);
    await s.clock.advance(0);
    expect(s.telegram.sent).toEqual([
      {
        text: expect.stringMatching(/^⏰ 12:01 \(late\) Back\n/),
        at: "2026-10-17T10:20:00.000Z",
      },
    ]);
  });
});
