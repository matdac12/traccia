import {
  type CreateTodoInput,
  type ListTodosInput,
  type Todo,
  todoSchema,
  type UpdateTodoInput,
} from "@traccia/shared";
import { z } from "zod";

/**
 * Typed requests to the Traccia API (docs/desktop-app.md §6). They go through the Rust side's
 * `api(method, path, body)` command, which adds the Token; this module only sees what came back.
 */

/** What the Rust `api` command returns (src-tauri/src/api.rs, `ApiOutcome`). */
export type ApiOutcome =
  | { kind: "response"; status: number; body: string }
  | { kind: "offline"; reason: string }
  | { kind: "notConfigured" };

export type ApiMethod = "GET" | "POST" | "PATCH";

/** Sends one request. In the app this is the Rust command (src/native.ts); tests pass a fake. */
export type Transport = (
  method: ApiMethod,
  path: string,
  body?: unknown,
) => Promise<ApiOutcome>;

export const REFUSED_MESSAGE = "Traccia refused the Token. Open Settings.";

export type ApiFailure =
  /** No network, a refused connection, or the 10 s timeout. */
  | { kind: "offline"; reason: string }
  /** 401 or 403: the Token is wrong, revoked, or lacks the `todos` scope. */
  | { kind: "refused"; status: number; message: string; apiMessage?: string }
  | { kind: "notConfigured"; message: string }
  /** Any other API error, with the standard `{ error: { code, message, details } }` body. */
  | {
      kind: "error";
      status: number;
      code?: string;
      message: string;
      details?: unknown;
    }
  /** A response this app can't read, or a request the Rust side refused to send. */
  | { kind: "invalid"; message: string };

export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: ApiFailure };

export const todoPageSchema = z.object({
  items: z.array(todoSchema),
  nextCursor: z.string().nullable(),
});
export type TodoPage = z.infer<typeof todoPageSchema>;

const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

/** The API's page size limit for `GET /v1/todos`. */
const PAGE_LIMIT = 250;

const UNREADABLE = "Traccia sent a response the Desktop app can't read.";

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function failure(status: number, body: string): ApiFailure {
  const parsed = errorBodySchema.safeParse(parseJson(body));
  const error = parsed.success ? parsed.data.error : undefined;
  if (status === 401 || status === 403) {
    return {
      kind: "refused",
      status,
      message: REFUSED_MESSAGE,
      ...(error && { apiMessage: error.message }),
    };
  }
  if (!error) {
    return { kind: "error", status, message: `Traccia answered ${status}.` };
  }
  return {
    kind: "error",
    status,
    code: error.code,
    message: error.message,
    ...(error.details !== undefined && { details: error.details }),
  };
}

/** Reads an outcome: a 2xx body through `schema`, anything else as a failure. */
export function interpret<T>(
  outcome: ApiOutcome,
  schema: z.ZodType<T>,
): ApiResult<T> {
  switch (outcome.kind) {
    case "offline":
      return {
        ok: false,
        failure: { kind: "offline", reason: outcome.reason },
      };
    case "notConfigured":
      return {
        ok: false,
        failure: {
          kind: "notConfigured",
          message: "Open Settings to connect to Traccia.",
        },
      };
    case "response": {
      if (outcome.status < 200 || outcome.status >= 300) {
        return { ok: false, failure: failure(outcome.status, outcome.body) };
      }
      const parsed = schema.safeParse(parseJson(outcome.body));
      return parsed.success
        ? { ok: true, value: parsed.data }
        : { ok: false, failure: { kind: "invalid", message: UNREADABLE } };
    }
  }
}

export function createApiClient(send: Transport) {
  async function request<T>(
    schema: z.ZodType<T>,
    method: ApiMethod,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    let outcome: ApiOutcome;
    try {
      outcome = await send(method, path, body);
    } catch (err) {
      // The Rust command refused to send it (a bad path, a bad API URL, Credential Manager).
      return {
        ok: false,
        failure: { kind: "invalid", message: String(err) },
      };
    }
    return interpret(outcome, schema);
  }

  function listTodos(input: ListTodosInput): Promise<ApiResult<TodoPage>> {
    const query = new URLSearchParams({ state: input.state });
    if (input.includeDeleted) query.set("includeDeleted", "true");
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    if (input.cursor) query.set("cursor", input.cursor);
    return request(todoPageSchema, "GET", `/v1/todos?${query}`);
  }

  return {
    listTodos,

    /** Every open To-do, Sub-to-dos included, paged to the end. */
    async listOpenTodos(): Promise<ApiResult<Todo[]>> {
      const todos: Todo[] = [];
      let cursor: string | undefined;
      do {
        const page = await listTodos({
          state: "open",
          limit: PAGE_LIMIT,
          cursor,
        });
        if (!page.ok) return page;
        todos.push(...page.value.items);
        cursor = page.value.nextCursor ?? undefined;
      } while (cursor);
      return { ok: true, value: todos };
    },

    createTodo(input: CreateTodoInput): Promise<ApiResult<Todo>> {
      return request(todoSchema, "POST", "/v1/todos", input);
    },

    updateTodo(id: string, input: UpdateTodoInput): Promise<ApiResult<Todo>> {
      return request(
        todoSchema,
        "PATCH",
        `/v1/todos/${encodeURIComponent(id)}`,
        input,
      );
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
