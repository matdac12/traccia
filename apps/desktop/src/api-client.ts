import {
  type CreateTodoInput,
  type ListTodosInput,
  todoSchema as sharedTodoSchema,
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

/**
 * A To-do as the API returns it: the shared schema, plus a parent's Sub-to-do count (`n/m`). The count comes with
 * TRC-177, which `packages/shared` on this branch doesn't have yet, so it is optional here; once the shared schema
 * has `subTodos`, this extension can go.
 */
export const todoSchema = sharedTodoSchema.extend({
  subTodos: z
    .object({ done: z.number().int().min(0), total: z.number().int().min(0) })
    .nullable()
    .optional(),
});
export type Todo = z.infer<typeof todoSchema>;

/**
 * A Project as `GET /v1/projects` lists it, narrowed to what the window uses (chip tooltips, and `@` autocomplete
 * from step 06). `packages/shared` has no Project response schema.
 */
export const projectSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  status: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

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

const projectPageSchema = z.object({
  items: z.array(projectSchema),
  nextCursor: z.string().nullable(),
});

const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

/** The API's page size limit. */
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

/** Follows `nextCursor` from the first page to the last, stopping at the first failure. */
async function pageToTheEnd<T>(
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<ApiResult<{ items: T[]; nextCursor: string | null }>>,
): Promise<ApiResult<T[]>> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    if (!page.ok) return page;
    items.push(...page.value.items);
    cursor = page.value.nextCursor ?? undefined;
  } while (cursor);
  return { ok: true, value: items };
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
    listOpenTodos(): Promise<ApiResult<Todo[]>> {
      return pageToTheEnd((cursor) =>
        listTodos({ state: "open", limit: PAGE_LIMIT, cursor }),
      );
    },

    /** Every live Project, paged to the end. */
    listProjects(): Promise<ApiResult<Project[]>> {
      return pageToTheEnd((cursor) => {
        const query = new URLSearchParams({ limit: String(PAGE_LIMIT) });
        if (cursor) query.set("cursor", cursor);
        return request(projectPageSchema, "GET", `/v1/projects?${query}`);
      });
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
