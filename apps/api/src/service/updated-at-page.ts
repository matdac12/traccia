import { ServiceError } from "@traccia/shared";
import {
  and,
  desc,
  eq,
  lt,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  DEFAULT_LIMIT,
  decodeCursor,
  encodeCursor,
  MAX_LIMIT,
} from "../rest/pagination.js";

/**
 * Shared bits of the memory and document lists: both are newest-updated
 * first, keyset-paginated on (`updated_at`, `id`), and filter by substring.
 */

export const pageLimit = (limit: number | undefined) =>
  Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);

export const updatedAtOrder = (t: {
  updatedAt: AnySQLiteColumn;
  id: AnySQLiteColumn;
}) => [desc(t.updatedAt), desc(t.id)];

/** `cursor` continues after the row it was made from; a bad one is `validation_error`. */
export function afterCursor(
  t: { updatedAt: AnySQLiteColumn; id: AnySQLiteColumn },
  cursor: string,
): SQL | undefined {
  let c: { u?: unknown; i?: unknown };
  try {
    c = decodeCursor(cursor) as typeof c;
  } catch {
    throw new ServiceError("validation_error", "Invalid cursor");
  }
  if (typeof c.u !== "string" || typeof c.i !== "string") {
    throw new ServiceError("validation_error", "Invalid cursor");
  }
  return or(lt(t.updatedAt, c.u), and(eq(t.updatedAt, c.u), lt(t.id, c.i)));
}

export const cursorOf = (row: { updatedAt: string; id: string }) =>
  encodeCursor({ u: row.updatedAt, i: row.id });

/** Case-insensitive (ASCII) substring match on either column; `%` and `_` are literal. */
export function containsEither(
  a: SQLWrapper,
  b: SQLWrapper,
  needle: string,
): SQL {
  const like = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
  return sql`(${a} LIKE ${like} ESCAPE '\\' OR ${b} LIKE ${like} ESCAPE '\\')`;
}
