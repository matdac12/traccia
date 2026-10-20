import "server-only";
import { searchParamsRecord } from "@traccia/shared";
import type { z } from "zod";
import { serverEnv } from "../server-env";
import { errorBodySchema } from "./schemas";

/** A non-2xx answer from the API, or a response that does not match its schema. */
export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** A query value as the caller writes it: the schema's text input, but booleans may stand in for `"true"` / `"false"`. */
type Relax<T> = T extends "true" | "false" ? T | boolean : T;
export type WireInput<QS extends z.ZodType> = { [K in keyof z.input<QS>]: Relax<z.input<QS>[K]> };

/**
 * `querySchema` / `bodySchema` are the shared REST request schemas (`@traccia/shared`) the API validates with.
 * `query` and `body` are typed against them, so a request the API would reject does not compile, and are
 * checked against them at runtime too. A request that sends neither takes neither.
 */
export type RequestOptions<S extends z.ZodType, QS extends z.ZodType | undefined = undefined, BS extends z.ZodType | undefined = undefined> = {
  schema: S;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  querySchema?: QS;
  query?: QS extends z.ZodType ? WireInput<QS> : undefined;
  bodySchema?: BS;
  body?: BS extends z.ZodType ? z.input<BS> : undefined;
  /** Sent as `If-Match`, the issue's last seen `updatedAt` (optimistic concurrency). */
  ifMatch?: string;
  /**
   * A GET that revalidates: the answer is kept with its `ETag`, and the next read of the same URL sends `If-None-Match`.
   * On a 304 the kept (parsed) answer is returned as it is, so treat it as read-only. For lists the API tags (To-dos).
   */
  conditional?: boolean;
  signal?: AbortSignal;
};

export type ApiClientConfig = {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  /** Test seam for the 429 backoff. */
  sleep?: (ms: number) => Promise<void>;
};

const MAX_RETRY_WAIT_MS = 5000;
const DEFAULT_RETRY_WAIT_MS = 1000;
/** Answers kept for `conditional` reads, oldest dropped first. */
const MAX_KEPT_ANSWERS = 32;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Server-side client for the Traccia REST API, authenticated with the dashboard's `you`
 * token. `import "server-only"` makes any import from a client component a build error, so
 * the token cannot reach the browser. Use it from server components, server actions and
 * route handlers only (see README).
 */
export function createApiClient({ baseUrl, token, fetch: rawFetch = fetch, sleep = defaultSleep }: ApiClientConfig) {
  const kept = new Map<string, { etag: string; value: unknown }>();
  /** Most recently read last, so the oldest go first when over the cap. */
  const remember = (href: string, answer: { etag: string; value: unknown }) => {
    kept.delete(href);
    kept.set(href, answer);
    for (const oldest of kept.keys()) {
      if (kept.size <= MAX_KEPT_ANSWERS) break;
      kept.delete(oldest);
    }
  };
  /** One retry on a 429, waiting `Retry-After` (capped) so a burst of page loads degrades to a short delay. */
  const fetchWithRetry: typeof fetch = async (input, init) => {
    const res = await rawFetch(input, init);
    // Safe for writes too: the API rejects before running the handler.
    if (res.status !== 429) return res;
    const seconds = Number(res.headers.get("retry-after"));
    await sleep(Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_WAIT_MS, MAX_RETRY_WAIT_MS));
    return rawFetch(input, init);
  };

  async function request<S extends z.ZodType, QS extends z.ZodType | undefined = undefined, BS extends z.ZodType | undefined = undefined>(
    path: string,
    { schema, method = "GET", querySchema, query, bodySchema, body, ifMatch, conditional, signal }: RequestOptions<S, QS, BS>,
  ): Promise<z.output<S>> {
    // Plain concatenation keeps any path prefix in the base URL (new URL("/v1…", base) would drop it).
    const url = new URL(`${baseUrl.replace(/\/+$/, "")}/v1${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(v));
    }
    if (querySchema) assertValid(querySchema, searchParamsRecord(url.searchParams), `${method} ${path} query`);
    if (bodySchema) assertValid(bodySchema, body, `${method} ${path} body`);
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (ifMatch) headers["if-match"] = ifMatch;
    const revalidate = conditional && method === "GET";
    const before = revalidate ? kept.get(url.href) : undefined;
    if (before) headers["if-none-match"] = before.etag;

    let res: Response;
    try {
      res = await fetchWithRetry(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal,
      });
    } catch (err) {
      throw new ApiError(0, "unreachable", `API unreachable at ${baseUrl}: ${String(err)}`);
    }

    if (res.status === 304 && before) {
      remember(url.href, before);
      return before.value as z.output<S>;
    }
    const text = await res.text();
    const json: unknown = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const parsed = errorBodySchema.safeParse(json);
      if (parsed.success) {
        const { code, message, details } = parsed.data.error;
        throw new ApiError(res.status, code, message, details);
      }
      throw new ApiError(res.status, "http_error", `API answered ${res.status}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(res.status, "bad_response", `Unexpected API response for ${method} ${path}: ${parsed.error.message}`);
    }
    const etag = revalidate ? res.headers.get("etag") : null;
    if (etag) remember(url.href, { etag, value: parsed.data });
    else kept.delete(url.href);
    return parsed.data;
  }

  /**
   * The API's raw response, for streaming files in and out (the proxy routes). Nothing is parsed or
   * buffered; the caller forwards the body. A network failure is an `unreachable` ApiError.
   */
  async function raw(
    path: string,
    {
      method = "GET",
      headers = {},
      body,
      signal,
      root = false,
    }: {
      method?: string;
      headers?: Record<string, string>;
      body?: BodyInit | null;
      signal?: AbortSignal /** `path` is relative to the API root, not `/v1` (document downloads: `/files/doc/:id`). */;
      root?: boolean;
    },
  ): Promise<Response> {
    const url = `${baseUrl.replace(/\/+$/, "")}${root ? "" : "/v1"}${path}`;
    try {
      return await fetchWithRetry(url, {
        method,
        headers: { ...headers, authorization: `Bearer ${token}` },
        body,
        cache: "no-store",
        signal,
        // A streamed request body needs half duplex; it is ignored when there is no body.
        ...(body ? { duplex: "half" } : {}),
      } as RequestInit);
    } catch (err) {
      throw new ApiError(0, "unreachable", `API unreachable at ${baseUrl}: ${String(err)}`);
    }
  }
  return { request, raw };
}

/** A request the shared schema rejects would be the API's 400: fail the same way (`validation_error`), before sending it. */
function assertValid(schema: z.ZodType, value: unknown, what: string) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "validation_error", `The ${what} does not satisfy the API's schema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export type ApiClient = ReturnType<typeof createApiClient>;

let shared: ApiClient | undefined;

/** The process-wide client, built from the validated server env. */
export function api(): ApiClient {
  if (!shared) {
    const env = serverEnv();
    shared = createApiClient({ baseUrl: env.apiUrl, token: env.apiToken });
  }
  return shared;
}
