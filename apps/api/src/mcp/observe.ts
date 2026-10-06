/**
 * Observability helpers for `/mcp`. Everything here extracts an allowlist of
 * fields (JSON-RPC method, tool name, error code and message); request
 * bodies, tool arguments and results are never copied into a log.
 */

/** A batch logs at most this many entries, so a log line stays bounded. */
const MAX_CALLS_LOGGED = 20;
const MAX_LABEL_LENGTH = 64;
const MAX_ERROR_MESSAGE_LENGTH = 200;
const MAX_HEADER_LENGTH = 128;

export type McpCall = { method: string; tool?: string };

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}…` : value;

/** Client-controlled text that reaches a log: bounded and without control characters. */
function safe(value: string, max: number): string {
  return clip(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    value.replace(/[\u0000-\u001f\u007f]/g, " "),
    max,
  );
}

/** Method (and tool name for `tools/call`) of each JSON-RPC message in a parsed body. */
export function describeCalls(parsed: unknown): {
  count: number;
  calls: McpCall[];
} {
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const calls: McpCall[] = [];
  for (const message of messages.slice(0, MAX_CALLS_LOGGED)) {
    if (typeof message !== "object" || message === null) continue;
    const { method, params } = message as {
      method?: unknown;
      params?: unknown;
    };
    if (typeof method !== "string") continue;
    const call: McpCall = { method: safe(method, MAX_LABEL_LENGTH) };
    if (method === "tools/call" && typeof params === "object" && params) {
      const { name } = params as { name?: unknown };
      if (typeof name === "string") call.tool = safe(name, MAX_LABEL_LENGTH);
    }
    calls.push(call);
  }
  return { count: messages.length, calls };
}

/** Value for the `Server-Timing` header: handler duration, labelled with what ran. */
export function serverTiming(ms: number, calls: McpCall[], count: number) {
  const first = calls[0];
  let label = "";
  if (count > 1) label = `batch of ${count}`;
  else if (first)
    label = first.tool ? `${first.method} ${first.tool}` : first.method;
  // Quoted-string: keep to a conservative charset so the header is always valid.
  const desc = label.replace(/[^A-Za-z0-9 _./:-]/g, "_");
  return `mcp;dur=${ms.toFixed(1)}${desc ? `;desc="${desc}"` : ""}`;
}

/** Bounded copy of a request header for logging, or undefined when absent. */
export function headerForLog(value: string | undefined): string | undefined {
  return value === undefined ? undefined : safe(value, MAX_HEADER_LENGTH);
}

/**
 * Error code and message from a 4xx response body. Handles the JSON-RPC shape
 * (`error.code` a number) and the REST envelope (`error.code` a string).
 * Never throws.
 */
export async function readErrorDetail(
  response: Response,
): Promise<{ errorCode?: number | string; errorMessage?: string }> {
  try {
    const body = (await response.clone().json()) as {
      error?: { code?: unknown; message?: unknown };
    };
    const { code, message } = body.error ?? {};
    return {
      errorCode:
        typeof code === "number"
          ? code
          : typeof code === "string"
            ? safe(code, MAX_LABEL_LENGTH)
            : undefined,
      errorMessage:
        typeof message === "string"
          ? safe(message, MAX_ERROR_MESSAGE_LENGTH)
          : undefined,
    };
  } catch {
    return {};
  }
}
