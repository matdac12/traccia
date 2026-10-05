import { z } from "zod";
import { ValidationError } from "../service/errors.js";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 250;

export type Page<T> = { items: T[]; nextCursor: string | null };

/** Opaque cursor: base64url of a JSON object. Callers validate the payload shape. */
export function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): unknown {
  try {
    const text = Buffer.from(cursor, "base64url").toString("utf8");
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("charset");
    const payload: unknown = JSON.parse(text);
    if (typeof payload !== "object" || payload === null)
      throw new Error("shape");
    return payload;
  } catch {
    throw new ValidationError("Invalid cursor", {
      fields: { cursor: ["Invalid cursor"] },
    });
  }
}

/**
 * `?limit=&cursor=`. `limit` is clamped to MAX_LIMIT; non-numeric or < 1 is a
 * validation error. `cursor` is decoded here, so a bad one fails validation.
 */
export const paginationQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_LIMIT)
    .transform((n) => Math.min(n, MAX_LIMIT)),
  cursor: z
    .string()
    .min(1)
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      try {
        return decodeCursor(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid cursor" });
        return z.NEVER;
      }
    }),
});

export type PaginationQuery = z.output<typeof paginationQuery>;

/**
 * Builds a page from rows fetched with `limit + 1`. If the extra row is
 * present there is a next page, and `cursorOf(lastKeptRow)` becomes the cursor.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (last: T) => unknown,
): Page<T> {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: encodeCursor(cursorOf(items[items.length - 1] as T)),
  };
}
