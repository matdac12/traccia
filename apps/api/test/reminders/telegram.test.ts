import { describe, expect, it } from "vitest";
import {
  createTelegramClient,
  redactToken,
  reminderText,
} from "../../src/reminders/telegram.js";

const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";

type Call = { url: string; init: RequestInit };

/** A client over a fake `fetch` that answers `respond` and records each call. */
function clientAnswering(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const client = createTelegramClient({
    botToken: TOKEN,
    chatId: "42",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return respond();
    },
  });
  return { client, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("reminderText", () => {
  it("is the time, the title, then the url on its own line", () => {
    expect(
      reminderText({
        time: "15:00",
        title: "Call the bank about the mortgage @CRM",
        url: "https://omni.example.ts.net/personal?todo=01ABC",
        late: false,
      }),
    ).toBe(
      "⏰ 15:00 Call the bank about the mortgage @CRM\nhttps://omni.example.ts.net/personal?todo=01ABC",
    );
  });

  it("puts (late) after the time", () => {
    expect(
      reminderText({ time: "09:00", title: "Gym", url: "u", late: true }),
    ).toBe("⏰ 09:00 (late) Gym\nu");
  });
});

describe("telegram.send", () => {
  it("posts plain text to sendMessage with link previews off", async () => {
    const { client, calls } = clientAnswering(() =>
      json(200, { ok: true, result: { message_id: 1 } }),
    );
    expect(await client.send("⏰ 15:00 Gym\nu")).toEqual({ kind: "ok" });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(call?.init.method).toBe("POST");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      chat_id: "42",
      text: "⏰ 15:00 Gym\nu",
      link_preview_options: { is_disabled: true },
    });
  });

  it("uses an injected API url", async () => {
    const calls: string[] = [];
    const client = createTelegramClient({
      botToken: TOKEN,
      chatId: "42",
      apiUrl: "http://127.0.0.1:8871/",
      fetch: async (url) => {
        calls.push(String(url));
        return json(200, { ok: true });
      },
    });
    await client.send("x");
    expect(calls).toEqual([`http://127.0.0.1:8871/bot${TOKEN}/sendMessage`]);
  });

  it("reads retry_after from a 429", async () => {
    const { client } = clientAnswering(() =>
      json(429, {
        ok: false,
        error_code: 429,
        description: "Too Many Requests: retry after 7",
        parameters: { retry_after: 7 },
      }),
    );
    expect(await client.send("x")).toEqual({
      kind: "rate_limited",
      retryAfterSeconds: 7,
    });
  });

  it.each([
    [500, "transient"],
    [502, "transient"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [400, "rejected"],
    [404, "rejected"],
  ])("classifies HTTP %i as %s", async (status, kind) => {
    const { client } = clientAnswering(() =>
      json(status, { ok: false, error_code: status, description: "nope" }),
    );
    expect(await client.send("x")).toMatchObject({ kind });
  });

  it("classifies a 5xx without a JSON body as transient", async () => {
    const { client } = clientAnswering(
      () => new Response("<html>bad gateway</html>", { status: 502 }),
    );
    expect(await client.send("x")).toMatchObject({ kind: "transient" });
  });

  it("classifies a network error and a timeout as transient", async () => {
    for (const error of [
      new TypeError("fetch failed"),
      new DOMException("The operation was aborted", "TimeoutError"),
    ]) {
      const { client } = clientAnswering(() => Promise.reject(error));
      expect(await client.send("x")).toMatchObject({ kind: "transient" });
    }
  });

  it("never puts the token in a failure reason", async () => {
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    const cases: Array<() => Promise<Response>> = [
      () => Promise.reject(new TypeError(`fetch failed for ${url}`)),
      () =>
        Promise.reject(
          new TypeError("fetch failed", { cause: new Error(`at ${url}`) }),
        ),
      async () =>
        json(400, { ok: false, error_code: 400, description: `bad ${url}` }),
    ];
    for (const respond of cases) {
      const { client } = clientAnswering(respond);
      const outcome = await client.send("x");
      expect(outcome.kind).not.toBe("ok");
      const reason = "reason" in outcome ? outcome.reason : "";
      expect(reason).not.toContain(TOKEN);
      expect(reason).not.toContain("AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw");
    }
  });
});

describe("redactToken", () => {
  it("replaces every bot<token> in a text", () => {
    expect(
      redactToken(
        `POST https://api.telegram.org/bot${TOKEN}/sendMessage and bot1:abc-_x`,
      ),
    ).toBe(
      "POST https://api.telegram.org/bot<redacted>/sendMessage and bot<redacted>",
    );
  });
});
