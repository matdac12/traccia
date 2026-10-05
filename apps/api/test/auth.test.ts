import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokens } from "../src/db/schema.js";
import { createToken, revokeToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

type Body = { error: { code: string; message: string; details: object } };

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

function setup(env: Record<string, string> = {}) {
  const t = createTestApp(env);
  const agent = createToken(t.db, { name: "claude-code", actor: "agent" });
  const you = createToken(t.db, { name: "dashboard", actor: "you" });
  const lastUsed = (id: string) =>
    t.db.select().from(tokens).where(eq(tokens.id, id)).get()?.lastUsedAt;
  return { ...t, agent, you, lastUsed };
}

async function expectUnauthorized(res: Response) {
  expect(res.status).toBe(401);
  const body = (await res.json()) as Body;
  expect(body.error.code).toBe("unauthorized");
  expect(typeof body.error.message).toBe("string");
  expect(body.error.details).toEqual({});
}

describe("GET /v1/me", () => {
  it("returns the actor and token name for a valid token", async () => {
    const { app, agent, you } = setup();
    const a = await app.request("/v1/me", { headers: bearer(agent.token) });
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({
      actor: "agent",
      tokenName: "claude-code",
    });
    const y = await app.request("/v1/me", { headers: bearer(you.token) });
    expect(await y.json()).toEqual({ actor: "you", tokenName: "dashboard" });
  });

  it("accepts a case-insensitive scheme", async () => {
    const { app, agent } = setup();
    const res = await app.request("/v1/me", {
      headers: { Authorization: `bearer ${agent.token}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("authentication failures", () => {
  it("rejects a missing header", async () => {
    const { app } = setup();
    await expectUnauthorized(await app.request("/v1/me"));
  });

  it("rejects the wrong scheme", async () => {
    const { app, agent } = setup();
    await expectUnauthorized(
      await app.request("/v1/me", {
        headers: { Authorization: `Basic ${agent.token}` },
      }),
    );
    await expectUnauthorized(
      await app.request("/v1/me", { headers: { Authorization: agent.token } }),
    );
  });

  it("rejects an unknown token", async () => {
    const { app } = setup();
    await expectUnauthorized(
      await app.request("/v1/me", {
        headers: bearer("trk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      }),
    );
    await expectUnauthorized(
      await app.request("/v1/me", { headers: bearer("") }),
    );
  });

  it("rejects a revoked token, effective on the very next request", async () => {
    const { app, db, agent } = setup();
    const ok = await app.request("/v1/me", { headers: bearer(agent.token) });
    expect(ok.status).toBe(200);
    revokeToken(db, agent.id);
    await expectUnauthorized(
      await app.request("/v1/me", { headers: bearer(agent.token) }),
    );
  });

  it("applies to unknown /v1 routes too, so routes can't be probed", async () => {
    const { app } = setup();
    await expectUnauthorized(await app.request("/v1/nonexistent"));
  });

  it("never logs the token", async () => {
    const { app, db, logs, agent } = setup();
    await app.request("/v1/me", { headers: bearer(agent.token) });
    await app.request("/v1/me", { headers: bearer(`${agent.token}x`) });
    revokeToken(db, agent.id);
    await app.request("/v1/me", { headers: bearer(agent.token) });
    expect(logs.join("\n")).not.toContain(agent.token);
  });
});

describe("/healthz", () => {
  it("stays unauthenticated", async () => {
    const { app } = setup();
    expect((await app.request("/healthz")).status).toBe(200);
  });
});

describe("last_used_at", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("is written at most once a minute per token", async () => {
    const { app, agent, you, lastUsed } = setup();
    expect(lastUsed(agent.id)).toBeNull();

    await app.request("/v1/me", { headers: bearer(agent.token) });
    expect(lastUsed(agent.id)).toBe("2026-01-01T00:00:00.000Z");

    vi.advanceTimersByTime(30_000);
    await app.request("/v1/me", { headers: bearer(agent.token) });
    vi.advanceTimersByTime(29_000);
    await app.request("/v1/me", { headers: bearer(agent.token) });
    expect(lastUsed(agent.id)).toBe("2026-01-01T00:00:00.000Z");

    vi.advanceTimersByTime(1_000);
    await app.request("/v1/me", { headers: bearer(agent.token) });
    expect(lastUsed(agent.id)).toBe("2026-01-01T00:01:00.000Z");

    // Tokens are throttled independently.
    expect(lastUsed(you.id)).toBeNull();
    await app.request("/v1/me", { headers: bearer(you.token) });
    expect(lastUsed(you.id)).toBe("2026-01-01T00:01:00.000Z");
  });

  it("does not write for failed authentication", async () => {
    const { app, sqlite } = setup();
    await app.request("/v1/me", { headers: bearer("trk_bogus") });
    const row = sqlite
      .prepare(
        "SELECT count(*) AS n FROM tokens WHERE last_used_at IS NOT NULL",
      )
      .get() as { n: number };
    expect(row.n).toBe(0);
  });
});

describe("rate limiting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns 429 on request 121 for that token only", async () => {
    const { app, agent, you } = setup();
    for (let i = 0; i < 120; i++) {
      const res = await app.request("/v1/me", { headers: bearer(agent.token) });
      expect(res.status).toBe(200);
    }
    const limited = await app.request("/v1/me", {
      headers: bearer(agent.token),
    });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as Body).error.code).toBe("rate_limited");
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);

    const other = await app.request("/v1/me", { headers: bearer(you.token) });
    expect(other.status).toBe(200);
  });

  it("gives `you` tokens their own, larger budget while agents stay at the default", async () => {
    const { app, agent, you } = setup();
    const hit = (token: string) => app.request("/v1/me", { headers: bearer(token) });
    // 30 page loads of ~11 requests each: far over the agent limit, well under the `you` one.
    for (let i = 0; i < 330; i++) expect((await hit(you.token)).status).toBe(200);
    for (let i = 0; i < 120; i++) expect((await hit(agent.token)).status).toBe(200);
    expect((await hit(agent.token)).status).toBe(429);
  });

  it("still limits `you` tokens at RATE_LIMIT_YOU_PER_MIN", async () => {
    const { app, you } = setup({ RATE_LIMIT_YOU_PER_MIN: "3" });
    const hit = () => app.request("/v1/me", { headers: bearer(you.token) });
    for (let i = 0; i < 3; i++) expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(429);
  });

  it("allows requests again once the window passes", async () => {
    const { app, agent } = setup({ RATE_LIMIT_PER_MIN: "2" });
    const hit = () => app.request("/v1/me", { headers: bearer(agent.token) });
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(429);
    vi.advanceTimersByTime(60_000);
    expect((await hit()).status).toBe(200);
  });

  it("does not count unauthenticated requests against any token", async () => {
    const { app, agent } = setup({ RATE_LIMIT_PER_MIN: "1" });
    for (let i = 0; i < 5; i++) await app.request("/v1/me");
    const res = await app.request("/v1/me", { headers: bearer(agent.token) });
    expect(res.status).toBe(200);
  });
});
