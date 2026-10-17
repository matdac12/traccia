// Reminder delivery through the Telegram Bot API (docs/personal-space.md §6.2,
// the TRC-144 research document): one plain-text `sendMessage` per Reminder,
// with link previews off, so nothing in a title needs escaping.
//
// The bot token is part of the request URL. Never log the URL or the token:
// every failure reason this module returns has `bot<…>` redacted.

/** What one `sendMessage` call came to, as the scheduler acts on it (§6.3). */
export type TelegramOutcome =
  | { kind: "ok" }
  /** 429: flood control; resend after `retryAfterSeconds`. */
  | { kind: "rate_limited"; retryAfterSeconds: number }
  /** 5xx, a network error or a timeout: retry with backoff. */
  | { kind: "transient"; reason: string }
  /** 401: the token was revoked or rotated. */
  | { kind: "unauthorized"; reason: string }
  /** 403: the bot is blocked, or the chat was never started. */
  | { kind: "forbidden"; reason: string }
  /** Any other 4xx: our request is wrong; never retried. */
  | { kind: "rejected"; reason: string };

export type TelegramClient = {
  /** Sends `text` to the configured chat. Never throws. */
  send(text: string): Promise<TelegramOutcome>;
};

const BOT_TOKEN_IN_TEXT = /bot\d+:[A-Za-z0-9_-]+/g;

/** `text` with every `bot<id>:<secret>` (as in the request URL) replaced. */
export function redactToken(text: string): string {
  return text.replace(BOT_TOKEN_IN_TEXT, "bot<redacted>");
}

/**
 * The message: `⏰ 15:00 <title>`, with `(late)` after the time when it goes
 * out late, then the To-do's url on its own line (a bare url, which Telegram
 * makes clickable without the inline-link confirmation).
 */
export function reminderText(r: {
  time: string;
  title: string;
  url: string;
  late: boolean;
}): string {
  return `⏰ ${r.time}${r.late ? " (late)" : ""} ${r.title}\n${r.url}`;
}

/** Without a `retry_after`, wait this long after a 429. */
const DEFAULT_RETRY_AFTER_SECONDS = 30;

export function createTelegramClient(options: {
  botToken: string;
  chatId: string;
  /** The Bot API origin; a local stub in an end-to-end try. */
  apiUrl?: string;
  fetch?: typeof fetch;
  /** Generous, so an ambiguous timeout (a possible duplicate) stays rare. */
  timeoutMs?: number;
}): TelegramClient {
  const doFetch = options.fetch ?? fetch;
  const apiUrl = (options.apiUrl ?? "https://api.telegram.org").replace(
    /\/+$/,
    "",
  );
  const timeoutMs = options.timeoutMs ?? 20_000;
  // The token may not match the `bot<id>:<secret>` shape a stub accepts, so
  // it is also removed verbatim.
  const redact = (text: string) =>
    redactToken(text).split(options.botToken).join("<redacted>");

  return {
    async send(text) {
      let res: Response;
      try {
        res = await doFetch(`${apiUrl}/bot${options.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: options.chatId,
            text,
            link_preview_options: { is_disabled: true },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        return { kind: "transient", reason: redact(describeError(err)) };
      }

      const body = await readBody(res);
      if (res.ok && body?.ok === true) return { kind: "ok" };
      const reason = redact(
        `HTTP ${res.status}${body?.description ? `: ${body.description}` : ""}`,
      );
      if (res.status === 429) {
        const after = body?.parameters?.retry_after;
        return {
          kind: "rate_limited",
          retryAfterSeconds:
            typeof after === "number" && after > 0
              ? after
              : DEFAULT_RETRY_AFTER_SECONDS,
        };
      }
      if (res.status === 401) return { kind: "unauthorized", reason };
      if (res.status === 403) return { kind: "forbidden", reason };
      if (res.status >= 400 && res.status < 500) {
        return { kind: "rejected", reason };
      }
      // 5xx, or a 2xx that isn't `ok: true`: the outcome is unknown, so retry
      // (at-least-once).
      return { kind: "transient", reason };
    },
  };
}

type ApiBody = {
  ok?: unknown;
  description?: string;
  parameters?: { retry_after?: unknown };
};

async function readBody(res: Response): Promise<ApiBody | undefined> {
  try {
    const body: unknown = await res.json();
    return typeof body === "object" && body !== null
      ? (body as ApiBody)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Name, message and cause of a fetch failure, before redaction. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? ` (${err.cause.message})` : "";
  return `${err.name}: ${err.message}${cause}`;
}
