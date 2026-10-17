import { ForbiddenError } from "../service/errors.js";
import type { TokenScope } from "../service/tokens.js";

const TODOS_PREFIX = "/v1/todos";
const PROJECTS_PATH = "/v1/projects";
const ME_PATH = "/v1/me";
const RESTORE_PATH = "/v1/restore";

/**
 * Thrown when a token's scope does not cover the request. Spells out what a
 * `todos` token may do, since Parla's operator is the one reading it.
 */
const todosScopeError = (reason: string) =>
  new ForbiddenError(
    `${reason} A token with scope "todos" may only use /v1/todos, POST /v1/restore for a todo, read-only GET /v1/projects, and /v1/me.`,
  );

/** `/v1/projects` or `/v1/projects/<id or key>`, nothing deeper. */
function isProjectRead(path: string): boolean {
  if (path === PROJECTS_PATH) return true;
  if (!path.startsWith(`${PROJECTS_PATH}/`)) return false;
  return !path.slice(PROJECTS_PATH.length + 1).includes("/");
}

/** Whether any `purge` query value is something other than an explicit `false`. */
function asksToPurge(purgeValues: string[]): boolean {
  return purgeValues.some((v) => v !== "false");
}

/**
 * Enforces a token's scope before any route runs; throws `forbidden` when the
 * request is outside it. `all` is unrestricted. `todos` is an allowlist
 * (default deny, so a route added later is closed to it until listed here):
 *
 * - everything under `/v1/todos`, except `?purge=true` on a delete (a
 *   misheard voice command must never erase a To-do for good);
 * - `/v1/me`;
 * - read-only `GET /v1/projects` and `GET /v1/projects/:id`;
 * - `POST /v1/restore`, whose body type is checked by `requireRestorable`.
 *
 * `path` is the router's own decoded path, so what is checked here is what
 * gets routed.
 */
export function enforceTokenScope(
  scope: TokenScope,
  request: { method: string; path: string; purgeValues: string[] },
): void {
  if (scope === "all") return;

  const method = request.method.toUpperCase();
  const { path } = request;
  const read = method === "GET" || method === "HEAD";

  if (path === TODOS_PREFIX || path.startsWith(`${TODOS_PREFIX}/`)) {
    if (method === "DELETE" && asksToPurge(request.purgeValues)) {
      throw todosScopeError("A todos token cannot purge a To-do.");
    }
    return;
  }
  if (path === ME_PATH && read) return;
  if (isProjectRead(path) && read) return;
  if (path === RESTORE_PATH && method === "POST") return;

  throw todosScopeError(`This token cannot use ${method} ${path}.`);
}

/** `POST /v1/restore` is the one shared route a `todos` token may reach, for To-dos only. */
export function requireRestorable(scope: TokenScope, type: string): void {
  if (scope === "todos" && type !== "todo") {
    throw todosScopeError(`This token cannot restore a ${type}.`);
  }
}
