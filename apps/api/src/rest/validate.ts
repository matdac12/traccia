import type { Context } from "hono";
import type { z } from "zod";
import { ValidationError } from "../service/errors.js";
import { zodDetails } from "./errors.js";

/** Parses `data` with `schema`; throws `validation_error` with field details. */
export function parse<S extends z.ZodType>(
  schema: S,
  data: unknown,
): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError("Validation failed", zodDetails(result.error));
  }
  return result.data;
}

export function validateQuery<S extends z.ZodType>(c: Context, schema: S) {
  // Repeated keys become arrays; single keys stay strings.
  const raw: Record<string, string | string[]> = {};
  for (const [key, value] of new URL(c.req.url).searchParams.entries()) {
    const existing = raw[key];
    if (existing === undefined) raw[key] = value;
    else
      raw[key] = [...(Array.isArray(existing) ? existing : [existing]), value];
  }
  return parse(schema, raw);
}

export function validateParams<S extends z.ZodType>(c: Context, schema: S) {
  return parse(schema, c.req.param());
}

export async function validateBody<S extends z.ZodType>(c: Context, schema: S) {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
  return parse(schema, json);
}

/** `If-Match: "<updated_at>"` (quotes and a weak prefix are tolerated). */
export function ifMatch(c: Context): string | undefined {
  const raw = c.req.header("If-Match")?.trim();
  if (!raw || raw === "*") return undefined;
  return raw.replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
}
