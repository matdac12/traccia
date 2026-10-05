import "server-only";
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

export type RequestOptions<S extends z.ZodType> = {
  schema: S;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | readonly string[] | undefined>;
  body?: unknown;
  /** Sent as `If-Match`, the issue's last seen `updatedAt` (optimistic concurrency). */
  ifMatch?: string;
  signal?: AbortSignal;
};

export type ApiClientConfig = {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
};

/**
 * Server-side client for the Traccia REST API, authenticated with the dashboard's `you`
 * token. `import "server-only"` makes any import from a client component a build error, so
 * the token cannot reach the browser. Use it from server components, server actions and
 * route handlers only (see README).
 */
export function createApiClient({ baseUrl, token, fetch: doFetch = fetch }: ApiClientConfig) {
  async function request<S extends z.ZodType>(
    path: string,
    { schema, method = "GET", query, body, ifMatch, signal }: RequestOptions<S>,
  ): Promise<z.output<S>> {
    // Plain concatenation keeps any path prefix in the base URL (new URL("/v1…", base) would drop it).
    const url = new URL(`${baseUrl.replace(/\/+$/, "")}/v1${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(v));
    }
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (ifMatch) headers["if-match"] = ifMatch;

    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal,
      });
    } catch (err) {
      throw new ApiError(0, "unreachable", `API unreachable at ${baseUrl}: ${String(err)}`);
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
    return parsed.data;
  }

  /**
   * The API's raw response, for streaming files in and out (the proxy routes). Nothing is parsed or
   * buffered; the caller forwards the body. A network failure is an `unreachable` ApiError.
   */
  async function raw(
    path: string,
    { method = "GET", headers = {}, body, signal }: { method?: string; headers?: Record<string, string>; body?: BodyInit | null; signal?: AbortSignal },
  ): Promise<Response> {
    const url = `${baseUrl.replace(/\/+$/, "")}/v1${path}`;
    try {
      return await doFetch(url, {
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
