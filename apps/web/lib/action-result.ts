import { ApiError } from "@/lib/api/client";

/** What a server action returns to its form: data, or a message plus per-field errors to show inline. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors: Record<string, string> };

export const success = <T>(data: T): ActionResult<T> => ({ ok: true, data });

export const failure = (error: string, fieldErrors: Record<string, string> = {}): ActionResult<never> => ({
  ok: false,
  error,
  fieldErrors,
});

/** Maps an API failure to a form-friendly result. Unknown errors (bugs) are rethrown. */
export function toFailure(err: unknown): ActionResult<never> {
  if (!(err instanceof ApiError)) throw err;
  if (err.code === "validation_error") {
    const fields = err.details.fields;
    const fieldErrors: Record<string, string> = {};
    if (fields && typeof fields === "object") {
      for (const [key, msgs] of Object.entries(fields)) {
        if (Array.isArray(msgs) && msgs.length) fieldErrors[key] = msgs.join(", ");
      }
    }
    return failure(err.message, fieldErrors);
  }
  if (err.code === "unreachable") return failure("Could not reach the API.");
  return failure(err.message);
}

/** Zod issues to `{ "path.to.field": "message" }` (first message per field). */
export function zodFieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.map(String).join(".") || "_";
    out[key] ??= i.message;
  }
  return out;
}
